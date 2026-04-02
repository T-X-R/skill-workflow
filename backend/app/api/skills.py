"""Skills API 路由

提供 Skill 列表和详情查询接口
"""

from fastapi import APIRouter, HTTPException, Request

from backend.app.models.skill import SkillMeta, SkillSummary


router = APIRouter(prefix="/api/skills", tags=["skills"])


@router.get("/", response_model=list[SkillSummary])
async def list_skills(
    request: Request,
    category: str | None = None,
    search: str | None = None
):
    """获取 Skill 列表（精简信息）
    
    Args:
        category: 可选，按分类过滤
        search: 可选，按关键词搜索（搜索名称和描述）
    
    Returns:
        list[SkillSummary]: Skill 摘要列表
    """
    registry = request.app.state.skill_registry
    
    if search:
        # 按关键词搜索
        return registry.search_skills(search)
    elif category:
        # 按分类过滤
        return registry.get_skills_by_category(category)
    else:
        # 返回所有
        return registry.get_all_summaries()


@router.get("/categories", response_model=list[str])
async def list_categories(request: Request):
    """获取所有 Skill 分类
    
    Returns:
        list[str]: 分类名称列表
    """
    registry = request.app.state.skill_registry
    return registry.get_all_categories()


@router.get("/{skill_id}", response_model=SkillMeta)
async def get_skill(request: Request, skill_id: str):
    """获取单个 Skill 完整详情
    
    Args:
        skill_id: Skill ID（目录名）
    
    Returns:
        SkillMeta: 完整的 Skill 元数据（含 SKILL.md 内容）
    
    Raises:
        404: Skill 不存在
    """
    registry = request.app.state.skill_registry
    skill = registry.get_skill(skill_id)
    
    if not skill:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{skill_id}' 不存在"
        )
    
    return skill
