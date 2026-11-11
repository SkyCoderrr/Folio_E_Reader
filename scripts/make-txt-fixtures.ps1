# Transcode the public-domain Gutenberg #23962 source into every contract encoding.
# Run: powershell -File scripts/make-txt-fixtures.ps1 [-OutputDir .test-profile/txt-fixtures]
param([string]$OutputDir = '.test-profile/txt-fixtures')
$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path $PSScriptRoot '../tests/fixtures'
$source = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'xiyouji-ch1-5-utf8.txt'), [Text.Encoding]::UTF8)
[IO.Directory]::CreateDirectory($OutputDir) | Out-Null
$encodings = [ordered]@{ 'utf-8'=65001; 'utf-16le'=1200; 'utf-16be'=1201; 'gb18030'=54936; 'big5'=950; 'shift_jis'=932; 'euc-kr'=51949; 'windows-1252'=1252 }
$report = [ordered]@{}
foreach ($name in $encodings.Keys) {
    $enc = [Text.Encoding]::GetEncoding($encodings[$name], [Text.EncoderReplacementFallback]::new('?'), [Text.DecoderReplacementFallback]::new([string][char]0xfffd))
    $bytes = $enc.GetBytes($source)
    if ($name -like 'utf-16*') { $bytes = $enc.GetPreamble() + $bytes }
    [IO.File]::WriteAllBytes((Join-Path $OutputDir "xiyouji-$name.txt"), $bytes)
    $report[$name] = @{ bytes=$bytes.Length; exactRoundTrip=($enc.GetString($enc.GetBytes($source)) -ceq $source) }
}
[IO.File]::WriteAllBytes((Join-Path $OutputDir 'utf-8-bom.txt'), [byte[]](0xef,0xbb,0xbf) + [Text.Encoding]::UTF8.GetBytes($source))
[IO.File]::WriteAllBytes((Join-Path $OutputDir 'gbk.txt'), [Text.Encoding]::GetEncoding(936).GetBytes($source))
[IO.File]::WriteAllBytes((Join-Path $OutputDir 'gb18030-four-byte.txt'), [Text.Encoding]::GetEncoding(54936).GetBytes([char]::ConvertFromUtf32(0x20000)))
[IO.File]::WriteAllText((Join-Path $OutputDir 'ascii.txt'), 'Chapter XII. Public domain text.', [Text.Encoding]::ASCII)
[IO.File]::WriteAllBytes((Join-Path $OutputDir 'windows-1252-latin.txt'), [byte[]](0x63,0x61,0x66,0xe9,0x20,0x80))
[IO.File]::WriteAllBytes((Join-Path $OutputDir 'truncated-utf8.txt'), [byte[]](0xef,0xbb,0xbf,0xe4,0xb8))
[IO.File]::WriteAllText((Join-Path $OutputDir 'mixed-newlines.txt'), "First`r`nSecond`nThird`r`n", [Text.UTF8Encoding]::new($false))
# Legacy encodings cannot represent all Chinese characters; '?' replacements are
# intentional and exactRoundTrip records this limitation rather than hiding it.
[IO.File]::WriteAllText((Join-Path $OutputDir 'transcode-report.json'), ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Output "Generated TXT fixtures in $OutputDir"
