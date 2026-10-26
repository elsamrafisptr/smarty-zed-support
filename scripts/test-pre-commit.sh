#!/bin/sh
# Tests .githooks/pre-commit in a throwaway repo. Run: sh scripts/test-pre-commit.sh
set -eu
hook="$(cd "$(dirname "$0")/.." && pwd)/.githooks/pre-commit"
repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q
cp "$hook" .git/hooks/pre-commit
printf 'package-lock.json linguist-generated\nvendor/** linguist-vendored\n' > .gitattributes
git add .gitattributes
git -c user.name=t -c user.email=t@t commit -qm init --no-verify
bytes() { head -c "$1" /dev/zero | tr '\0' 'a'; }
fails=0
check() { # check <name> <expect: pass|block>
	if out=$(sh .git/hooks/pre-commit 2>&1); then got=pass; else got=block; fi
	if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1 (got $got)"; echo "$out"; fails=1; fi
	git reset -q
}

bytes 100 > small.js;          git add small.js;                 check "small authored file" pass
bytes 20003 > edge.js;         git add edge.js;                  check "exactly 5000 tokens" pass
bytes 20004 > big.js;          git add big.js;                   check "5001 tokens" block
bytes 30000 > package-lock.json; git add package-lock.json;      check "lockfile exempt" pass
mkdir vendor; bytes 30000 > vendor/lib.js; git add vendor/lib.js; check "vendored exempt" pass
head -c 30000 /dev/urandom > blob.bin; git add blob.bin;          check "binary exempt" pass
bytes 10 > staged.js; git add staged.js; bytes 30000 > staged.js; check "only staged content counts" pass
git init -q sub; (cd sub && bytes 30000 > a.js && git add a.js && git -c user.name=t -c user.email=t@t commit -qm a --no-verify)
git add sub 2>/dev/null;                                          check "submodule pointer skipped" pass
bytes 30000 > untracked.js;                                       check "unstaged file ignored" pass

bytes 20004 > big.js; git add big.js
out=$(sh .git/hooks/pre-commit 2>&1 || true)
case "$out" in *"5001 tokens  big.js"*"How to split"*) echo "ok   message names file and explains split" ;;
	*) echo "FAIL message"; echo "$out"; fails=1 ;; esac

exit $fails
