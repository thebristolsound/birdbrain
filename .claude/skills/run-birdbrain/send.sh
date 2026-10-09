#!/usr/bin/env bash
# Send one line to the driver running in a tmux session, wait for it to finish, print the tail.
# usage: send.sh <driver command> [timeout-seconds] [lines-to-print]
# The session name comes from BIRDBRAIN_TMUX (default: bb).
set -u
session=${BIRDBRAIN_TMUX:-bb}
cmd=$1
limit=${2:-30}
lines=${3:-6}

tmux send-keys -t "$session" "$cmd" Enter
sleep 0.3
for _ in $(seq $((limit * 5))); do
  # capture-pane trims trailing spaces, so the prompt reads "driver>" not "driver> ".
  last=$(tmux capture-pane -t "$session" -p | grep -v '^$' | tail -1)
  [ "$last" = 'driver>' ] && break
  # After quit the pane drops back to the shell.
  case $(tmux display-message -p -t "$session" '#{pane_current_command}') in
    xvfb-run | sh | node) ;;
    *) break ;;
  esac
  sleep 0.2
done
tmux capture-pane -t "$session" -p | grep -v '^$' | tail -"$lines"
