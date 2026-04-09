"""SKILL.md Markdown parser.

Parses SKILL.md files to extract skill metadata including:
- YAML frontmatter (name, description)
- Input parameters from markdown tables
- Output descriptions
- Category inference
"""

import re
from pathlib import Path
from typing import Any

from backend.app.models.skill import SkillMeta, SkillIO, SkillParam


# Category inference rules based on skill name patterns
CATEGORY_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(asr|speech|语音)", re.I), "语音处理"),
    (re.compile(r"(subtitle|srt|字幕)", re.I), "字幕处理"),
    (re.compile(r"(face|beauty|美颜|人脸)", re.I), "人脸处理"),
    (re.compile(r"(oss|upload|下载|上传)", re.I), "文件存储"),
    (re.compile(r"(video|视频)", re.I), "视频处理"),
    (re.compile(r"(audio|音频|音量)", re.I), "音频处理"),
    (re.compile(r"(detect|检测)", re.I), "检测分析"),
    (re.compile(r"(metadata|元数据|validate|校验)", re.I), "元数据"),
    (re.compile(r"(concat|merge|cut|trim|crop|裁剪|拼接)", re.I), "视频编辑"),
    (re.compile(r"(extract|提取)", re.I), "提取处理"),
    (re.compile(r"(render|渲染|animation|动画)", re.I), "渲染处理"),
    (re.compile(r"(workflow|工作流|cleanup|清理)", re.I), "工作流"),
]


def infer_category(skill_id: str, content: str) -> str:
    """Infer skill category from ID and content."""
    text = f"{skill_id} {content}"
    for pattern, category in CATEGORY_RULES:
        if pattern.search(text):
            return category
    return "通用"


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from markdown content.
    
    Returns:
        Tuple of (frontmatter dict, remaining content)
    """
    frontmatter: dict[str, Any] = {}
    body = content
    
    # Match frontmatter block
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if fm_match:
        fm_content = fm_match.group(1)
        body = content[fm_match.end():]
        
        # Simple YAML parsing (key: value pairs)
        for line in fm_content.split('\n'):
            line = line.strip()
            if ':' in line:
                key, value = line.split(':', 1)
                frontmatter[key.strip()] = value.strip()
    
    return frontmatter, body


def parse_markdown_table(section: str) -> list[dict[str, str]]:
    """Parse a markdown table into list of dicts.
    
    Expected format:
    | 参数 | 必填 | 说明 |
    |------|------|------|
    | param_name | 是 | description |
    """
    rows: list[dict[str, str]] = []
    lines = section.strip().split('\n')
    
    # Find table header
    header_idx = -1
    for i, line in enumerate(lines):
        if line.strip().startswith('|') and '|' in line[1:]:
            header_idx = i
            break
    
    if header_idx < 0:
        return rows
    
    # Parse header
    header_line = lines[header_idx]
    headers = [h.strip() for h in header_line.split('|')[1:-1]]
    
    if not headers:
        return rows
    
    # Skip separator line (|------|------|)
    data_start = header_idx + 2
    
    # Parse data rows
    for line in lines[data_start:]:
        if not line.strip().startswith('|'):
            break
        cells = [c.strip() for c in line.split('|')[1:-1]]
        if len(cells) >= len(headers):
            row = dict(zip(headers, cells))
            rows.append(row)
    
    return rows


def parse_params_from_table(table_rows: list[dict[str, str]]) -> list[SkillParam]:
    """Convert table rows to SkillParam objects."""
    params: list[SkillParam] = []
    
    for row in table_rows:
        # Try different column name variants
        name = (
            row.get('参数', '') or 
            row.get('param', '') or 
            row.get('name', '') or
            row.get('参数名', '')
        ).strip('`')
        
        if not name:
            continue
        
        # Get default value first (needed for required check)
        default_str = row.get('默认', '') or row.get('default', '')
        default = None
        if default_str and default_str.lower() not in ('必填', 'required', '是'):
            default = default_str
        
        # Determine if required
        required_str = (
            row.get('必填', '') or 
            row.get('required', '') or 
            row.get('是否必填', '') or
            row.get('类型', '')  # Sometimes "必填" is in type column
        ).lower()
        # Check if default column contains "必填"
        required = (
            required_str in ('是', 'yes', 'true', '必填') or 
            '必填' in required_str or
            default_str.lower() in ('必填', 'required')
        )
        
        # Get description
        description = (
            row.get('说明', '') or 
            row.get('description', '') or 
            row.get('描述', '') or
            row.get('备注', '')
        )
        
        # Get type
        param_type = (
            row.get('类型', '') or 
            row.get('type', '') or 
            'string'
        ).lower()
        
        # Map common types
        if param_type in ('str', 'string', 'path', '路径', '字符串'):
            param_type = 'string'
        elif param_type in ('int', 'float', 'number', '数字', '浮点'):
            param_type = 'number'
        elif param_type in ('bool', 'boolean', '布尔'):
            param_type = 'boolean'
        
        params.append(SkillParam(
            name=name,
            type=param_type,
            description=description,
            required=required,
            default=default,
        ))
    
    return params


def parse_outputs(section: str) -> list[SkillIO]:
    """Parse output section to extract output definitions."""
    outputs: list[SkillIO] = []
    
    # Try to find structured output (JSON example or list)
    lines = section.strip().split('\n')
    
    # Look for bullet points or list items
    for line in lines:
        line = line.strip()
        if line.startswith('- ') or line.startswith('* '):
            item = line[2:].strip()
            # Extract name from backticks or first word
            name_match = re.match(r'`([^`]+)`|(\w+)', item)
            if name_match:
                name = name_match.group(1) or name_match.group(2)
                # Rest is description
                desc = item[name_match.end():].strip(' :：-—')
                outputs.append(SkillIO(
                    name=name,
                    type="string",
                    description=desc or item,
                ))
    
    # If no structured outputs found, create a generic one
    if not outputs and section.strip():
        outputs.append(SkillIO(
            name="output",
            type="string", 
            description=section.strip()[:200],
        ))
    
    return outputs


def extract_section(content: str, header: str) -> str:
    """Extract content of a specific markdown section.
    
    Args:
        content: Full markdown content
        header: Section header text (without ##)
    
    Returns:
        Section content (may be empty)
    """
    # Match ## header or ### header (using [#] to avoid brace issues)
    escaped_header = re.escape(header)
    pattern = rf'^[#]{{2,3}}\s*{escaped_header}\s*$'
    match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
    
    if not match:
        return ""
    
    start = match.end()
    
    # Find next section header
    next_header = re.search(r'^[#]{1,3}\s+', content[start:], re.MULTILINE)
    if next_header:
        end = start + next_header.start()
    else:
        end = len(content)
    
    return content[start:end].strip()


def parse_skill_md(skill_dir: Path) -> SkillMeta | None:
    """Parse a SKILL.md file from a skill directory.
    
    Args:
        skill_dir: Path to the skill directory
    
    Returns:
        SkillMeta object or None if parsing fails
    """
    skill_md_path = skill_dir / "SKILL.md"
    
    if not skill_md_path.exists():
        return None
    
    try:
        content = skill_md_path.read_text(encoding='utf-8')
    except Exception:
        return None
    
    skill_id = skill_dir.name
    
    # Parse frontmatter
    frontmatter, body = parse_frontmatter(content)
    
    # Get name (fallback to directory name or first H1)
    name = frontmatter.get('name', '')
    if not name:
        h1_match = re.search(r'^#\s+(.+)$', body, re.MULTILINE)
        name = h1_match.group(1).strip() if h1_match else skill_id
    
    # Get description
    description = frontmatter.get('description', '')
    
    # Get category (if specified in frontmatter)
    category = frontmatter.get('category', '')
    if not category:
        category = infer_category(skill_id, content)
    
    # Parse input parameters
    params: list[SkillParam] = []
    for section_name in ['输入参数', '输入', 'Input', 'Inputs', 'Parameters']:
        section = extract_section(content, section_name)
        if section:
            table_rows = parse_markdown_table(section)
            params = parse_params_from_table(table_rows)
            if params:
                break
    
    # Parse outputs
    outputs: list[SkillIO] = []
    for section_name in ['输出', 'Output', 'Outputs']:
        section = extract_section(content, section_name)
        if section:
            outputs = parse_outputs(section)
            if outputs:
                break
    
    # Convert params to inputs (for workflow node connections)
    inputs = [
        SkillIO(name=p.name, type=p.type, description=p.description)
        for p in params if p.required
    ]
    
    # Check for script
    script_path = skill_dir / "scripts" / "run.py"
    has_script = script_path.exists()

    preferred_model = frontmatter.get('preferred_model', None) or None
    
    return SkillMeta(
        id=skill_id,
        name=name,
        description=description,
        category=category,
        inputs=inputs,
        outputs=outputs,
        params=params,
        has_script=has_script,
        script_path=str(script_path) if has_script else None,
        preferred_model=preferred_model,
        skill_md_content=content,
    )
