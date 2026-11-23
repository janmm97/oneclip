# Security policy

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please report privately via GitHub: Security tab → "Report a vulnerability". Don't open a public issue.
We aim to reply within 7 days and to fix confirmed issues in the next release.

## Scope

OneClip runs on your own computer. It reads untrusted input (video files, transcripts, YouTube metadata, and the JSON an editing agent returns) and starts local processes (the One CLI, Python/faster-whisper, FFmpeg, Remotion, Claude Code or OpenCode). We especially want to hear about:

- transcript text or agent output that gets OneClip to run a command, write outside its data folder, or use an operation, template or preset that isn't on the allow-list;
- argument or path injection into FFmpeg, the One CLI, Python or an agent;
- ways another website or local process can drive the local server (it binds to 127.0.0.1 and only serves its own page);
- anything that logs or stores One connection keys, tokens or other secrets.
