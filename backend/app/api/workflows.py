"""Workflows API 路由

提供工作流的 CRUD 操作接口，以及将工作流发布为可调用接口的功能
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request

from backend.app.models.workflow import (
    Workflow,
    WorkflowCreate,
    WorkflowUpdate,
)
from backend.app.models.session import SessionType


router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.get("/", response_model=list[Workflow])
async def list_workflows(request: Request):
    """列出所有保存的工作流
    
    Returns:
        list[Workflow]: 工作流列表，按创建时间倒序排列
    """
    store = request.app.state.store
    return store.list_workflows()


@router.post("/", response_model=Workflow, status_code=201)
async def create_workflow(request: Request, data: WorkflowCreate):
    """创建新工作流
    
    Args:
        data: 工作流创建数据
    
    Returns:
        Workflow: 创建的工作流对象
    """
    store = request.app.state.store
    
    # 创建 Workflow 对象
    workflow = Workflow(
        name=data.name,
        description=data.description,
        nodes=data.nodes,
        edges=data.edges,
        is_draft=data.is_draft,
    )
    
    # 保存到存储
    saved_workflow = store.save_workflow(workflow)
    
    return saved_workflow


@router.get("/{workflow_id}", response_model=Workflow)
async def get_workflow(request: Request, workflow_id: str):
    """获取工作流详情
    
    Args:
        workflow_id: 工作流 ID
    
    Returns:
        Workflow: 工作流对象
    
    Raises:
        404: 工作流不存在
    """
    store = request.app.state.store
    workflow = store.load_workflow(workflow_id)
    
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"工作流 '{workflow_id}' 不存在"
        )
    
    return workflow


@router.put("/{workflow_id}", response_model=Workflow)
async def update_workflow(
    request: Request,
    workflow_id: str,
    data: WorkflowUpdate
):
    """更新工作流
    
    Args:
        workflow_id: 工作流 ID
        data: 更新数据（只更新提供的字段）
    
    Returns:
        Workflow: 更新后的工作流对象
    
    Raises:
        404: 工作流不存在
    """
    store = request.app.state.store
    
    # 加载现有工作流
    workflow = store.load_workflow(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"工作流 '{workflow_id}' 不存在"
        )
    
    # 更新字段（只更新非 None 的字段）
    if data.name is not None:
        workflow.name = data.name
    if data.description is not None:
        workflow.description = data.description
    if data.nodes is not None:
        workflow.nodes = data.nodes
    if data.edges is not None:
        workflow.edges = data.edges
    if data.is_draft is not None:
        workflow.is_draft = data.is_draft
    if data.is_published is not None:
        workflow.is_published = data.is_published
    
    # 更新时间戳
    workflow.updated_at = datetime.now()
    
    # 保存
    saved_workflow = store.save_workflow(workflow)
    
    return saved_workflow


@router.delete("/{workflow_id}")
async def delete_workflow(request: Request, workflow_id: str):
    """删除工作流
    
    Args:
        workflow_id: 工作流 ID
    
    Returns:
        dict: 删除结果消息
    
    Raises:
        404: 工作流不存在
    """
    store = request.app.state.store
    
    # 检查工作流是否存在
    workflow = store.load_workflow(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"工作流 '{workflow_id}' 不存在"
        )
    
    # 删除
    success = store.delete_workflow(workflow_id)
    
    if not success:
        raise HTTPException(
            status_code=500,
            detail="删除工作流失败"
        )
    
    return {"message": f"工作流 '{workflow_id}' 已删除"}


@router.post("/{workflow_id}/run", status_code=202)
async def run_workflow(
    request: Request,
    workflow_id: str,
    body: dict[str, Any] = Body(default={}),
):
    """触发已发布的工作流执行（面向自动化/批量调用场景）

    创建一个 batch session 并后台启动执行。
    - external_ref：可选，关联外部视频 ID，便于后续追溯
    - param_overrides：可选，覆盖指定节点的参数

    Args:
        workflow_id: 工作流 ID
        body: {
            "param_overrides": {"node_id": {"param": "value"}},
            "external_ref": "video-123"
        }

    Returns:
        {"session_id": "...", "message": "..."}

    Raises:
        404: 工作流不存在
        403: 工作流未发布
        500: 启动执行失败
    """
    store = request.app.state.store
    session_manager = request.app.state.session_manager

    workflow = store.load_workflow(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"工作流 '{workflow_id}' 不存在"
        )

    if not workflow.is_published:
        raise HTTPException(
            status_code=403,
            detail="该工作流尚未发布，无法通过接口调用。请先在流程库中将其发布。"
        )

    external_ref = body.get("external_ref")
    param_overrides = body.get("param_overrides", {})

    try:
        session = await session_manager.create_session(
            session_type=SessionType.BATCH,
            external_ref=external_ref,
            workflow_id=workflow_id,
            visible=False,
        )

        await session_manager.start_workflow_background(
            session_id=session.id,
            workflow=workflow,
            param_overrides=param_overrides,
        )

        return {
            "session_id": session.id,
            "workflow_id": workflow_id,
            "external_ref": external_ref,
            "message": "工作流执行已在后台启动",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"启动执行失败: {e}")
