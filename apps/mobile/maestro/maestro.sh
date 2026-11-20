#!/bin/zsh
# Runs Maestro (UI tests: real taps and swipes) against the development build
# already open in the booted Simulator, with Metro running. Usage, from the
# repo root:
#   apps/mobile/maestro/maestro.sh test apps/mobile/maestro/gestures.yaml
#   apps/mobile/maestro/maestro.sh hierarchy      (what Maestro sees on screen)
# Maestro is installed with Homebrew (mobile-dev-inc/tap/maestro) and needs
# Java 17+. Its anonymous usage data and its in-terminal adverts are off here.
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
export PATH="$(brew --prefix openjdk)/bin:$PATH"
device=$(xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' | head -1)
[ -z "$device" ] && { echo "No booted Simulator. Start one first."; exit 1; }
cmd=$1; shift
exec maestro --device "$device" "$cmd" "$@" 2> >(grep -v "^WARNING:" >&2)
