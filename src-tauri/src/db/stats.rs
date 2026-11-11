use super::*;
use chrono::{Datelike, Local, NaiveDate, TimeZone};
use rusqlite::{OptionalExtension, params};

fn date(value: &str, field: &str) -> Result<NaiveDate, AppError> {
    let day = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| invalid(field, "Expected YYYY-MM-DD"))?;
    if !(1..=9999).contains(&day.year()) || day.format("%Y-%m-%d").to_string() != value {
        return Err(invalid(field, "Expected YYYY-MM-DD"));
    }
    Ok(day)
}

struct Fragment {
    day: String,
    start: i64,
    end: i64,
    active: u64,
    chars: u64,
    start_progress: f64,
    end_progress: f64,
}

fn validate(s: &ReadingSessionInput) -> Result<(), AppError> {
    validate_id(&s.book_id)?;
    if s.started_at < 0
        || s.ended_at <= s.started_at
        || s.ended_at > 253_402_300_799_999
        || s.ended_at - s.started_at > 366 * 86_400_000
        || s.active_ms > (s.ended_at - s.started_at) as u64
        || s.chars_read > SAFE_INTEGER
        || !s.start_progress.is_finite()
        || !s.end_progress.is_finite()
        || !(0.0..=1.0).contains(&s.start_progress)
        || !(0.0..=1.0).contains(&s.end_progress)
    {
        return Err(invalid("session", "Session exceeds contract bounds"));
    }
    Ok(())
}

fn split<T: TimeZone>(s: &ReadingSessionInput, tz: &T) -> Result<Vec<Fragment>, AppError> {
    let duration = (s.ended_at - s.started_at) as u64;
    let allocated = |count: u64, elapsed: u64| -> u64 {
        (u128::from(count) * u128::from(elapsed) / u128::from(duration)) as u64
    };
    let progress = |elapsed: u64| {
        s.start_progress + (s.end_progress - s.start_progress) * elapsed as f64 / duration as f64
    };
    let mut start = s.started_at;
    let mut rows = Vec::new();
    while start < s.ended_at {
        let day = tz
            .timestamp_millis_opt(start)
            .single()
            .ok_or_else(|| invalid("session", "Unrepresentable local timestamp"))?
            .date_naive();
        let next = day
            .succ_opt()
            .ok_or_else(|| invalid("session", "Date overflow"))?;
        // Some zones advance at midnight. Select the first representable local
        // hour on the next date; earliest resolves a repeated midnight.
        let midnight = (0..24)
            .find_map(|hour| {
                tz.from_local_datetime(&next.and_hms_opt(hour, 0, 0).unwrap())
                    .earliest()
            })
            .ok_or_else(|| invalid("session", "Unrepresentable local day boundary"))?;
        let end = s.ended_at.min(midnight.timestamp_millis());
        if end <= start {
            return Err(invalid("session", "Invalid local day boundary"));
        }
        let before = (start - s.started_at) as u64;
        let after = (end - s.started_at) as u64;
        rows.push(Fragment {
            day: day.format("%Y-%m-%d").to_string(),
            start,
            end,
            active: allocated(s.active_ms, after) - allocated(s.active_ms, before),
            chars: allocated(s.chars_read, after) - allocated(s.chars_read, before),
            start_progress: progress(before),
            end_progress: progress(after),
        });
        start = end;
    }
    Ok(rows)
}

fn exists(c: &Connection, id: &str) -> Result<(), AppError> {
    c.query_row("SELECT 1 FROM books WHERE id=?1", [id], |_| Ok(()))
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| missing(id))
}

fn add(target: &mut u64, value: u64) -> Result<(), AppError> {
    *target = target
        .checked_add(value)
        .filter(|v| *v <= SAFE_INTEGER)
        .ok_or_else(|| db_error("Stats aggregate exceeds safe integer bounds"))?;
    Ok(())
}

impl Database {
    pub fn stats_session_save(&self, session: ReadingSessionInput) -> Result<(), AppError> {
        self.save_session_in_timezone(session, &Local)
    }

    fn save_session_in_timezone<T: TimeZone>(
        &self,
        s: ReadingSessionInput,
        tz: &T,
    ) -> Result<(), AppError> {
        validate(&s)?;
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            exists(&tx, &s.book_id)?;
            if s.active_ms >= 10_000 {
                for row in split(&s, tz)? {
                    tx.execute("INSERT INTO sessions(book_id,local_day,started_at,ended_at,active_ms,chars_advanced,start_progress,end_progress) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![s.book_id,row.day,row.start,row.end,row.active as i64,row.chars as i64,row.start_progress,row.end_progress]).map_err(db_error)?;
                }
            }
            tx.commit().map_err(db_error)
        })
    }

    pub fn book_set_total_chars(&self, id: &str, total: u64) -> Result<(), AppError> {
        validate_id(id)?;
        if total > SAFE_INTEGER {
            return Err(invalid("totalChars", "Expected nonnegative safe integer"));
        }
        self.with(|c| {
            if c.execute(
                "UPDATE books SET total_chars=?2 WHERE id=?1",
                params![id, total as i64],
            )
            .map_err(db_error)?
                == 0
            {
                return Err(missing(id));
            }
            Ok(())
        })
    }

    pub fn stats_query(&self, from: &str, to: &str) -> Result<StatsQueryResult, AppError> {
        let first = date(from, "fromDay")?;
        let last = date(to, "toDay")?;
        let count = (last - first).num_days() + 1;
        if !(1..=3660).contains(&count) {
            return Err(invalid(
                "toDay",
                "Expected ordered range of at most 3660 days",
            ));
        }
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?;
            let mut days: Vec<_> = (0..count).map(|offset| StatsDay {
                day: (first + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string(),
                active_ms: 0, chars: 0,
            }).collect();
            let mut stmt = tx.prepare("SELECT id,title,progress,finished_at IS NOT NULL FROM books ORDER BY id").map_err(db_error)?;
            let mut books = stmt.query_map([], |r| Ok(StatsBook {
                book_id: r.get(0)?, title: r.get(1)?, progress: r.get(2)?, finished: r.get(3)?,
                active_ms: 0, chars: 0, last_read_at: None, chars_per_min: None,
            })).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
            let mut stmt = tx.prepare("SELECT book_id,local_day,ended_at,active_ms,chars_advanced FROM sessions WHERE local_day BETWEEN ?1 AND ?2 ORDER BY ended_at DESC,id DESC").map_err(db_error)?;
            let mut rows = stmt.query([from,to]).map_err(db_error)?;
            let mut windows = vec![(0u64,0.0); books.len()];
            while let Some(r) = rows.next().map_err(db_error)? {
                let id: String = r.get(0).map_err(db_error)?;
                let day: String = r.get(1).map_err(db_error)?;
                let end: i64 = r.get(2).map_err(db_error)?;
                let active = u64::try_from(r.get::<_,i64>(3).map_err(db_error)?).map_err(db_error)?;
                let chars = u64::try_from(r.get::<_,i64>(4).map_err(db_error)?).map_err(db_error)?;
                let index = books.binary_search_by(|b| b.book_id.cmp(&id)).map_err(|_| db_error("Orphan stats row"))?;
                let book = &mut books[index];
                add(&mut book.active_ms,active)?; add(&mut book.chars,chars)?;
                book.last_read_at = Some(book.last_read_at.map_or(end, |v| v.max(end)));
                let offset = (date(&day,"local_day").map_err(db_error)? - first).num_days() as usize;
                let entry = days.get_mut(offset).ok_or_else(|| db_error("Invalid stored day"))?;
                add(&mut entry.active_ms,active)?; add(&mut entry.chars,chars)?;
                let (used, advanced) = &mut windows[index];
                if active > 0 && *used < 1_800_000 {
                    let take = active.min(1_800_000 - *used);
                    *advanced += chars as f64 * take as f64 / active as f64;
                    *used += take;
                }
            }
            for (book,(used,chars)) in books.iter_mut().zip(windows) {
                if book.active_ms >= 300_000 { book.chars_per_min = Some(chars * 60_000.0 / used as f64); }
            }
            let mut totals = StatsTotals { active_ms: 0, chars: 0 };
            for day in &days { add(&mut totals.active_ms,day.active_ms)?; add(&mut totals.chars,day.chars)?; }
            Ok(StatsQueryResult { days,books,totals })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, LocalResult, NaiveDateTime, Utc};
    const ID: &str = "0123456789abcdef0123456789abcdef";

    // Deterministic 2026 London transitions, independent of the host timezone.
    #[derive(Clone)]
    struct London2026;
    impl TimeZone for London2026 {
        type Offset = FixedOffset;
        fn from_offset(_: &Self::Offset) -> Self {
            Self
        }
        fn offset_from_local_date(&self, d: &NaiveDate) -> LocalResult<FixedOffset> {
            self.offset_from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
        }
        fn offset_from_utc_date(&self, d: &NaiveDate) -> FixedOffset {
            self.offset_from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
        }
        fn offset_from_local_datetime(&self, d: &NaiveDateTime) -> LocalResult<FixedOffset> {
            let mut valid = [0, 3600].into_iter().filter_map(|secs| {
                let offset = FixedOffset::east_opt(secs).unwrap();
                (self.offset_from_utc_datetime(&(*d - chrono::Duration::seconds(secs.into())))
                    == offset)
                    .then_some(offset)
            });
            match (valid.next(), valid.next()) {
                (None, _) => LocalResult::None,
                (Some(a), None) => LocalResult::Single(a),
                (Some(a), Some(b)) => LocalResult::Ambiguous(b, a),
            }
        }
        fn offset_from_utc_datetime(&self, d: &NaiveDateTime) -> FixedOffset {
            let spring = NaiveDate::from_ymd_opt(2026, 3, 29)
                .unwrap()
                .and_hms_opt(1, 0, 0)
                .unwrap();
            let autumn = NaiveDate::from_ymd_opt(2026, 10, 25)
                .unwrap()
                .and_hms_opt(1, 0, 0)
                .unwrap();
            FixedOffset::east_opt(if *d >= spring && *d < autumn { 3600 } else { 0 }).unwrap()
        }
    }
    fn session(start: i64, end: i64, active: u64, chars: u64) -> ReadingSessionInput {
        ReadingSessionInput {
            book_id: ID.into(),
            started_at: start,
            ended_at: end,
            active_ms: active,
            chars_read: chars,
            start_progress: 0.2,
            end_progress: 0.8,
        }
    }
    fn fixture() -> (tempfile::TempDir, Database) {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-profile/m8-stats");
        std::fs::create_dir_all(&root).unwrap();
        let tmp = tempfile::tempdir_in(root).unwrap();
        let profile = Profile::resolve(Some(tmp.path().join("profile").into_os_string()), || {
            panic!("real profile")
        })
        .unwrap();
        let db = Database::open(profile.clone(), profile.root.join("library"));
        db.with(|c| {
            c.execute("INSERT INTO books(id,format,title,file_name,file_rel_path,file_size,added_at) VALUES (?1,'epub','Title','book.epub',?2,1,0)",params![ID,format!("{ID}.epub")]).map_err(db_error)?;
            Ok(())
        }).unwrap();
        (tmp, db)
    }
    fn ms(day: &str) -> i64 {
        Utc.from_utc_datetime(&date(day, "day").unwrap().and_hms_opt(0, 0, 0).unwrap())
            .timestamp_millis()
    }
    #[test]
    fn midnight_split_preserves_counts_and_short_fragments() {
        let (_tmp, db) = fixture();
        let midnight = ms("2026-11-10");
        db.save_session_in_timezone(session(midnight - 5000, midnight + 5001, 10000, 7), &Utc)
            .unwrap();
        let q = db.stats_query("2026-11-09", "2026-11-10").unwrap();
        assert_eq!((q.days[0].active_ms, q.days[1].active_ms), (4999, 5001));
        assert_eq!((q.days[0].chars, q.days[1].chars), (3, 4));
        assert_eq!((q.totals.active_ms, q.totals.chars), (10000, 7));
        db.with(|c| {
            let (a, b): (f64, f64) = c
                .query_row(
                    "SELECT start_progress,end_progress FROM sessions ORDER BY started_at LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(a, 0.2);
            assert!((b - 0.4999700029997).abs() < 1e-10);
            Ok(())
        })
        .unwrap();
    }
    #[test]
    fn dst_calendar_days_have_23_and_25_hours() {
        for (first, middle, last, hours) in [
            ("2026-03-28", "2026-03-29", "2026-03-30", 23),
            ("2026-10-24", "2026-10-25", "2026-10-26", 25),
        ] {
            let local = |d| {
                London2026
                    .from_local_datetime(&date(d, "day").unwrap().and_hms_opt(0, 0, 0).unwrap())
                    .single()
                    .unwrap()
                    .timestamp_millis()
            };
            let start = local(first);
            let end = local(last);
            let s = session(start, end, (end - start) as u64, 1001);
            let rows = split(&s, &London2026).unwrap();
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[1].day, middle);
            assert_eq!(rows[1].end - rows[1].start, hours * 3_600_000);
            assert_eq!(rows.iter().map(|r| r.active).sum::<u64>(), s.active_ms);
            assert_eq!(rows.iter().map(|r| r.chars).sum::<u64>(), 1001);
        }
    }
    #[test]
    fn short_session_dropped_boundary_accepted_and_missing_book_checked() {
        let (_tmp, db) = fixture();
        let start = ms("2026-11-10");
        db.save_session_in_timezone(session(start, start + 10000, 9999, 99), &Utc)
            .unwrap();
        assert_eq!(
            db.stats_query("2026-11-10", "2026-11-10")
                .unwrap()
                .totals
                .active_ms,
            0
        );
        db.save_session_in_timezone(session(start, start + 10000, 10000, 99), &Utc)
            .unwrap();
        let mut missing = session(start, start + 10000, 1, 0);
        missing.book_id = "00000000000000000000000000000000".into();
        assert_eq!(
            db.stats_session_save(missing).unwrap_err().code,
            ErrorCode::BookNotFound
        );
        assert_eq!(
            db.book_set_total_chars("00000000000000000000000000000000", 1)
                .unwrap_err()
                .code,
            ErrorCode::BookNotFound
        );
        assert_eq!(
            db.stats_query("2026-11-10", "2026-11-10")
                .unwrap()
                .totals
                .active_ms,
            10000
        );
    }
    #[test]
    fn query_zeros_ranges_current_metadata_and_rolling_speed() {
        let (_tmp, db) = fixture();
        let start = ms("2026-11-10");
        db.save_session_in_timezone(session(start, start + 1_200_000, 1_200_000, 1200), &Utc)
            .unwrap();
        db.save_session_in_timezone(
            session(start + 1_200_000, start + 2_400_000, 1_200_000, 2400),
            &Utc,
        )
        .unwrap();
        db.with(|c| {
            c.execute(
                "UPDATE books SET progress=0.8,finished_at=1 WHERE id=?1",
                [ID],
            )
            .unwrap();
            Ok(())
        })
        .unwrap();
        let q = db.stats_query("2026-11-09", "2026-11-11").unwrap();
        assert_eq!(q.days.len(), 3);
        assert_eq!(q.days[0].active_ms, 0);
        assert_eq!(q.days[2].chars, 0);
        let b = &q.books[0];
        assert_eq!((b.active_ms, b.chars), (2_400_000, 3600));
        assert_eq!(b.title, "Title");
        assert!(b.finished);
        assert_eq!(b.progress, 0.8);
        assert_eq!(b.last_read_at, Some(start + 2_400_000));
        assert_eq!(b.chars_per_min, Some(100.0));
        let empty = db.stats_query("2026-11-11", "2026-11-11").unwrap();
        assert_eq!(empty.books[0].active_ms, 0);
        assert_eq!(empty.books[0].last_read_at, None);
        assert_eq!(empty.books[0].chars_per_min, None);
    }
    #[test]
    fn speed_needs_five_active_minutes_and_total_chars_survives_reopen() {
        let (_tmp, db) = fixture();
        let start = ms("2026-11-10");
        db.save_session_in_timezone(session(start, start + 299999, 299999, 100), &Utc)
            .unwrap();
        assert_eq!(
            db.stats_query("2026-11-10", "2026-11-10").unwrap().books[0].chars_per_min,
            None
        );
        db.book_set_total_chars(ID, 12345).unwrap();
        let profile = db.profile.clone();
        let library = db.library_dir();
        drop(db);
        let db = Database::open(profile, library);
        assert_eq!(db.get(ID).unwrap().total_chars, Some(12345));
    }
    #[test]
    fn invalid_input_and_overflow_leave_no_partial_write() {
        let (_tmp, db) = fixture();
        for mut s in [
            session(1, 1, 0, 0),
            session(-1, 10000, 1, 1),
            session(0, 10000, 10001, 1),
            session(0, 10000, 10000, SAFE_INTEGER + 1),
        ] {
            assert_eq!(
                db.stats_session_save(s.clone()).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
            s.start_progress = f64::NAN;
            assert!(db.stats_session_save(s).is_err());
        }
        for (a, b) in [
            ("2026-02-30", "2026-03-01"),
            ("2026-11-10", "2026-11-09"),
            ("2026-1-01", "2026-11-10"),
            ("0000-01-01", "2026-01-01"),
        ] {
            assert_eq!(
                db.stats_query(a, b).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
        }
        assert!(db.book_set_total_chars(ID, SAFE_INTEGER + 1).is_err());
        let start = ms("2026-11-10");
        for _ in 0..2 {
            db.save_session_in_timezone(session(start, start + 10000, 10000, SAFE_INTEGER), &Utc)
                .unwrap();
        }
        assert_eq!(
            db.stats_query("2026-11-10", "2026-11-10").unwrap_err().code,
            ErrorCode::DbError
        );
    }
}
