"""任务处理函数注册：导入各模块的处理函数，使 @job_handler 生效。worker 与测试都从这里导入。

同时导入全部模型，保证外键引用的表都已注册到 metadata（worker 进程不经过 FastAPI 应用初始化）。
"""

from app import models  # noqa: F401
from app.modules.companies import extraction  # noqa: F401
