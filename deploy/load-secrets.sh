#!/usr/bin/env bash
# Reads every parameter under /findmyhobby/prod/ from AWS Parameter Store (decrypted using the server's IAM role)
# and writes KEY=value lines to /run/fmh/api.env, which lives in memory only and is readable by the fmh user alone.
set -euo pipefail
mkdir -p /run/fmh && chmod 750 /run/fmh && chown root:fmh /run/fmh
umask 077
aws ssm get-parameters-by-path --path /findmyhobby/prod/ --with-decryption --recursive \
  --query 'Parameters[*].[Name,Value]' --output text \
  | awk -F '\t' '{ n = $1; sub(".*/", "", n); print n "=" $2 }' > /run/fmh/api.env.tmp
mv /run/fmh/api.env.tmp /run/fmh/api.env
chown root:fmh /run/fmh/api.env && chmod 640 /run/fmh/api.env
