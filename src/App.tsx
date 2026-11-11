import CaptionTestPage from './dev/CaptionTestPage';
import Playground from './dev/Playground';
import LibraryDemo from './dev/LibraryDemo';
import TocDemo from './dev/TocDemo';
import TxtDemo from './dev/TxtDemo';
import StatsDemo from './dev/StatsDemo';
import MainApp from './app/MainApp';
export default function App() {
  return import.meta.env.DEV && location.hash === '#playground' ? (
    <Playground />
  ) : import.meta.env.DEV && location.hash === '#library' ? (
    <LibraryDemo />
  ) : import.meta.env.DEV && location.hash === '#toc' ? (
    <TocDemo />
  ) : import.meta.env.DEV && location.hash === '#txt' ? (
    <TxtDemo />
  ) : import.meta.env.DEV && (location.hash === '#stats' || location.hash === '#autoscroll') ? (
    <StatsDemo />
  ) : import.meta.env.DEV && location.hash === '#caption-test' ? (
    <CaptionTestPage />
  ) : (
    <MainApp />
  );
}
