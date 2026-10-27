"""导入全部助手工具模块，使 @tool 注册生效。新增工具模块后在这里登记。"""

from app.modules.assistant import profile_tools  # noqa: F401
from app.modules.leads import tools as lead_tools  # noqa: F401
from app.modules.outreach import tools as outreach_tools  # noqa: F401
from app.modules.sites import tools as site_tools  # noqa: F401
