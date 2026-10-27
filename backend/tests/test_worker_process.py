"""worker 启动冒烟测试：在独立子进程中启动 worker（与生产相同的导入路径），确认能处理任务。

防止「测试进程已导入全部模型，而 worker 进程没有」这类只在真实运行时暴露的问题。
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap

from tests.conftest import BACKEND_DIR


def test_worker_process_can_run_jobs_in_fresh_interpreter() -> None:
    script = textwrap.dedent(
        """
        from app.workers import __main__ as worker  # 与 python -m app.workers 相同的导入
        from app.core.db import Base
        assert {"users", "companies", "profile_extractions", "jobs"} <= set(Base.metadata.tables)
        from app.core.jobs import registered_kinds
        assert "profile.extract" in registered_kinds(), registered_kinds()
        print("ok")
        """
    )
    env = {**os.environ}
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script], cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=60
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().endswith("ok")
