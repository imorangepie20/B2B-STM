#!/bin/sh
set -eu

check() {
  label=$1
  url=$2
  result=$(curl --location --fail --silent --show-error --output /dev/null \
    --write-out '%{http_code} %{url_effective}' --max-time 10 --retry 2 "$url") || {
      echo "FAIL $label" >&2
      return 1
    }
  status=${result%% *}
  final_url=${result#* }
  [ "$status" = 200 ] || {
    echo "FAIL $label status=$status" >&2
    return 1
  }
  echo "PASS $label status=$status final=$final_url"
}

check "local API live" "http://127.0.0.1:3200/api/health/live"
check "local API ready" "http://127.0.0.1:3200/api/health/ready"
check "local Web" "http://127.0.0.1:3101/"
check "public Web" "https://stm.approid.team/"
check "public API ready" "https://stm.approid.team/api/health/ready"
