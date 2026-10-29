#!/usr/bin/env python3
"""Install one reviewed CLI file atomically; preserve a private rollback copy."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import uuid


def regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Use an existing regular file, not a symlink.")


def atomic_write(target, data, mode):
    fd, temporary = tempfile.mkstemp(prefix="." + target.name + ".", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), mode)
        if target.is_symlink():
            raise ValueError("Refusing to replace a symlink target.")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(target, source=None, rollback=None):
    target = Path(os.path.abspath(os.path.expanduser(str(target))))
    if target.is_symlink():
        raise ValueError("Refusing to replace a symlink target.")
    if target.exists():
        regular(target)
    candidate = Path(rollback) if rollback else (source or Path(__file__).with_name("ras-github"))
    regular(candidate)
    if rollback and (candidate.parent.resolve() != target.parent.resolve() or
                     not candidate.name.startswith(target.name + ".backup-")):
        raise ValueError("Rollback must use this target's sibling backup file.")
    data = candidate.read_bytes()
    ast.parse(data, filename="ras-github")
    digest = hashlib.sha256(data).hexdigest()
    if target.exists() and target.read_bytes() == data:
        # Repair an executable bit lost by file transfer without creating backups.
        target.chmod(stat.S_IMODE(target.stat().st_mode) | stat.S_IXUSR)
        return {"status": "unchanged", "target": str(target), "sha256": digest}
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = None
    if target.exists():
        backup = target.with_name(target.name + ".backup-" + uuid.uuid4().hex)
        fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(target.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
    atomic_write(target, data, 0o755)
    if target.read_bytes() != data:
        raise ValueError("Installed bytes differ; inspect the retained backup.")
    return {"status": "restored" if rollback else "installed", "target": str(target),
            "backup": str(backup) if backup else None, "sha256": digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default="~/workspace/tools/ras-github")
    parser.add_argument("--rollback", help="exact sibling backup printed by a previous installation")
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.target, rollback=args.rollback)))
        return 0
    except (OSError, ValueError, SyntaxError):
        print(json.dumps({"status": "failed", "error": "Installation did not finish. Check the target, source and backup; no connector credentials were changed."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
