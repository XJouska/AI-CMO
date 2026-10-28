"""任务处理函数注册：导入各模块的处理函数，使 @job_handler 生效。worker 与测试都从这里导入。

同时导入全部模型，保证外键引用的表都已注册到 metadata（worker 进程不经过 FastAPI 应用初始化）。
"""

from app import models  # noqa: F401
from app.modules.admin import notifications  # noqa: F401
from app.modules.admin import router as admin_router  # noqa: F401
from app.modules.companies import extraction  # noqa: F401
from app.modules.leads import pipeline as leads_pipeline  # noqa: F401
from app.modules.sites import service as sites_service  # noqa: F401
from app.workers import scheduler  # noqa: F401
