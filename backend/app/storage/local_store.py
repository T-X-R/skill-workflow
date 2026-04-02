"""本地 JSON 文件存储实现"""

import json
import threading
from pathlib import Path
from datetime import datetime

from ..models.workflow import Workflow
from ..models.session import Session


class LocalStore:
    """本地 JSON 文件存储管理器
    
    使用文件系统存储工作流、执行记录和会话，
    每个实体保存为单独的 JSON 文件，文件名为 {id}.json
    """
    
    def __init__(self, data_dir: str):
        """初始化存储管理器
        
        Args:
            data_dir: 数据存储根目录
        """
        self.data_dir = Path(data_dir)
        self.workflows_dir = self.data_dir / "workflows"
        self.sessions_dir = self.data_dir / "sessions"
        
        # 确保目录存在
        self.workflows_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        
        # 线程锁保证线程安全
        self._workflow_lock = threading.RLock()
        self._session_lock = threading.RLock()
    
    # ==================== Workflow CRUD ====================
    
    def save_workflow(self, workflow: Workflow) -> Workflow:
        """保存工作流
        
        Args:
            workflow: 工作流对象
            
        Returns:
            保存后的工作流对象（更新了 updated_at）
        """
        with self._workflow_lock:
            # 更新时间戳
            workflow.updated_at = datetime.now()
            
            file_path = self.workflows_dir / f"{workflow.id}.json"
            json_data = workflow.model_dump_json(indent=2)
            file_path.write_text(json_data, encoding="utf-8")
            
            return workflow
    
    def load_workflow(self, workflow_id: str) -> Workflow | None:
        """加载工作流
        
        Args:
            workflow_id: 工作流 ID
            
        Returns:
            工作流对象，如果不存在返回 None
        """
        with self._workflow_lock:
            file_path = self.workflows_dir / f"{workflow_id}.json"
            
            if not file_path.exists():
                return None
            
            try:
                json_data = file_path.read_text(encoding="utf-8")
                return Workflow.model_validate_json(json_data)
            except (json.JSONDecodeError, ValueError):
                return None
    
    def list_workflows(self, include_drafts: bool = False) -> list[Workflow]:
        """列出工作流
        
        Args:
            include_drafts: 是否包含草稿（执行时自动保存的临时工作流），默认不包含
            
        Returns:
            工作流列表，按创建时间倒序排列
        """
        with self._workflow_lock:
            workflows = []
            
            for file_path in self.workflows_dir.glob("*.json"):
                try:
                    json_data = file_path.read_text(encoding="utf-8")
                    workflow = Workflow.model_validate_json(json_data)
                    if not include_drafts and workflow.is_draft:
                        continue
                    workflows.append(workflow)
                except (json.JSONDecodeError, ValueError):
                    # 跳过无效文件
                    continue
            
            # 按创建时间倒序排列
            workflows.sort(key=lambda w: w.created_at, reverse=True)
            return workflows
    
    def delete_workflow(self, workflow_id: str) -> bool:
        """删除工作流
        
        Args:
            workflow_id: 工作流 ID
            
        Returns:
            是否删除成功
        """
        with self._workflow_lock:
            file_path = self.workflows_dir / f"{workflow_id}.json"
            
            if not file_path.exists():
                return False
            
            try:
                file_path.unlink()
                return True
            except OSError:
                return False
    
    # ==================== Session CRUD ====================

    def save_session(self, session: Session) -> Session:
        """保存 Session"""
        with self._session_lock:
            file_path = self.sessions_dir / f"{session.id}.json"
            file_path.write_text(session.model_dump_json(indent=2), encoding="utf-8")
            return session

    def load_session(self, session_id: str) -> Session | None:
        """加载 Session"""
        with self._session_lock:
            file_path = self.sessions_dir / f"{session_id}.json"
            if not file_path.exists():
                return None
            try:
                return Session.model_validate_json(file_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, ValueError):
                return None

    def list_sessions(self, visible_only: bool = True) -> list[Session]:
        """列出 Session，按创建时间倒序"""
        with self._session_lock:
            sessions = []
            for file_path in self.sessions_dir.glob("*.json"):
                try:
                    session = Session.model_validate_json(
                        file_path.read_text(encoding="utf-8")
                    )
                    if visible_only and not session.visible:
                        continue
                    sessions.append(session)
                except (json.JSONDecodeError, ValueError):
                    continue
            sessions.sort(key=lambda s: s.created_at, reverse=True)
            return sessions

    def find_sessions_by_ref(self, external_ref: str) -> list[Session]:
        """按 external_ref 查找 Session"""
        with self._session_lock:
            results = []
            for file_path in self.sessions_dir.glob("*.json"):
                try:
                    session = Session.model_validate_json(
                        file_path.read_text(encoding="utf-8")
                    )
                    if session.external_ref == external_ref:
                        results.append(session)
                except (json.JSONDecodeError, ValueError):
                    continue
            results.sort(key=lambda s: s.created_at, reverse=True)
            return results

    def delete_session(self, session_id: str) -> bool:
        """删除 Session"""
        with self._session_lock:
            file_path = self.sessions_dir / f"{session_id}.json"
            if not file_path.exists():
                return False
            try:
                file_path.unlink()
                return True
            except OSError:
                return False
