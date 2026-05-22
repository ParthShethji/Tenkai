#!/bin/bash

# This script simulates development activity by making periodic commits
# It modifies a log file and pushes the commit periodically.

LOG_FILE="build_activity.log"

echo "Starting build simulation. Press Ctrl+C to stop."

while true; do
  # Generate a random sleep time between 30 minutes and 2 hours (1800 to 7200 seconds)
  # You can adjust this for more or less frequent commits.
  SLEEP_TIME=$(( (RANDOM % 5400) + 1800 ))
  echo "Waiting for $((SLEEP_TIME / 60)) minutes before next commit..."
  sleep $SLEEP_TIME

  # Make a small change to simulate activity
  echo "Automated build process ran at $(date)" >> "$LOG_FILE"
  
  # Add and commit the change
  git add "$LOG_FILE"
  
  # Pick a random commit message from a list to make it look realistic
  MESSAGES=(
    "chore: update internal dependencies"
    "fix: resolve minor edge case in processing"
    "feat: optimize background tasks"
    "refactor: clean up code structure"
    "docs: update inline documentation"
    "test: add missing test cases"
    "chore: internal system updates"
    "style: code formatting and linting"
    "fix: address intermittent timeout"
    "chore: tweak configuration parameters"
  )
  RANDOM_INDEX=$(( RANDOM % ${#MESSAGES[@]} ))
  COMMIT_MSG="${MESSAGES[$RANDOM_INDEX]}"

  git commit -m "$COMMIT_MSG"
  
  # Push changes to the repository
  git push origin main
  
  echo "Committed and pushed: $COMMIT_MSG"
done
