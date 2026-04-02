"""Workflow DAG 工具函数

仅保留 DAG 验证与拓扑排序等纯工具逻辑。
实际执行由 Orchestrator Agent 完成。
"""
from __future__ import annotations

from collections import defaultdict, deque

from backend.app.models.workflow import Workflow, WorkflowNode


class WorkflowEngine:
    """DAG 工具：验证、排序、查询"""

    def validate_dag(self, workflow: Workflow) -> tuple[bool, str | None]:
        """验证 DAG 有效性，检测环路（Kahn 算法）。

        Returns:
            (is_valid, error_message)
        """
        if not workflow.nodes:
            return True, None

        in_degree: dict[str, int] = {node.node_id: 0 for node in workflow.nodes}
        adjacency: dict[str, list[str]] = defaultdict(list)
        node_ids = {node.node_id for node in workflow.nodes}

        for edge in workflow.edges:
            if edge.source_node_id not in node_ids:
                return False, f"边的源节点 '{edge.source_node_id}' 不存在"
            if edge.target_node_id not in node_ids:
                return False, f"边的目标节点 '{edge.target_node_id}' 不存在"
            adjacency[edge.source_node_id].append(edge.target_node_id)
            in_degree[edge.target_node_id] += 1

        queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
        visited = 0
        while queue:
            nid = queue.popleft()
            visited += 1
            for neighbor in adjacency[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if visited != len(workflow.nodes):
            return False, "工作流中存在环路，无法执行"
        return True, None

    def topological_sort(self, workflow: Workflow) -> list[str]:
        """拓扑排序，返回 node_id 的执行顺序列表（Kahn 算法）。"""
        if not workflow.nodes:
            return []

        in_degree: dict[str, int] = {node.node_id: 0 for node in workflow.nodes}
        adjacency: dict[str, list[str]] = defaultdict(list)

        for edge in workflow.edges:
            adjacency[edge.source_node_id].append(edge.target_node_id)
            in_degree[edge.target_node_id] += 1

        queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
        sorted_nodes: list[str] = []

        while queue:
            nid = queue.popleft()
            sorted_nodes.append(nid)
            for neighbor in adjacency[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        return sorted_nodes

    def get_upstream_nodes(self, workflow: Workflow, node_id: str) -> list[str]:
        """获取指定节点的直接上游节点 ID 列表。"""
        return [e.source_node_id for e in workflow.edges if e.target_node_id == node_id]

    def get_downstream_nodes(self, workflow: Workflow, node_id: str) -> list[str]:
        """获取指定节点的直接下游节点 ID 列表。"""
        return [e.target_node_id for e in workflow.edges if e.source_node_id == node_id]

    def get_all_downstream_nodes(self, workflow: Workflow, node_id: str) -> set[str]:
        """获取指定节点的所有下游节点（递归，包括间接下游）。"""
        all_downstream: set[str] = set()
        queue: deque[str] = deque([node_id])
        while queue:
            current = queue.popleft()
            for ds in self.get_downstream_nodes(workflow, current):
                if ds not in all_downstream:
                    all_downstream.add(ds)
                    queue.append(ds)
        return all_downstream

    def _build_node_map(self, workflow: Workflow) -> dict[str, WorkflowNode]:
        return {node.node_id: node for node in workflow.nodes}
