# Changelog

## Unreleased
- Handle transient ENOENT errors when resolving existing symlink targets during copy.
- Sync existing contents when a newly detected directory is created or moved in.
- Skip events from destination paths nested under the source to avoid recursive copy loops.
