"""Skill registry for managing and discovering skills.

Provides progressive disclosure loading via SkillRegistry class.
"""

import logging
from pathlib import Path

from backend.app.config import SKILLS_DIR
from backend.app.models.skill import SkillMeta, SkillSummary
from backend.app.core.skill_parser import parse_skill_md


logger = logging.getLogger(__name__)


class SkillRegistry:
    """Registry for managing skill metadata."""
    
    def __init__(self, skills_dir: Path | None = None):
        """Initialize the registry.
        
        Args:
            skills_dir: Directory containing skill folders. Defaults to SKILLS_DIR.
        """
        self._skills_dir = skills_dir or SKILLS_DIR
        self._summaries: dict[str, SkillSummary] = {}
        self._full_cache: dict[str, SkillMeta] = {}
        self._loaded = False
    
    def _ensure_loaded(self) -> None:
        """Ensure summaries are loaded (lazy initialization)."""
        if self._loaded:
            return
        self._scan_skills()
        self._loaded = True
    
    def _scan_skills(self) -> None:
        """Scan skills directory and load summaries."""
        if not self._skills_dir.exists():
            logger.warning(f"Skills directory not found: {self._skills_dir}")
            return
        
        for skill_dir in self._skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            
            try:
                meta = parse_skill_md(skill_dir)
                if meta:
                    self._summaries[meta.id] = SkillSummary.from_meta(meta)
                    # Optionally cache full meta if parsing was successful
                    self._full_cache[meta.id] = meta
            except Exception as e:
                logger.error(f"Failed to parse skill {skill_dir.name}: {e}")
    
    def reload(self) -> None:
        """Force reload all skills."""
        self._summaries.clear()
        self._full_cache.clear()
        self._loaded = False
        self._ensure_loaded()
    
    def get_all_summaries(self) -> list[SkillSummary]:
        """Get all skill summaries (lightweight).
        
        Returns:
            List of SkillSummary objects
        """
        self._ensure_loaded()
        return list(self._summaries.values())
    
    def get_skill(self, skill_id: str) -> SkillMeta | None:
        """Get full skill metadata by ID.
        
        Args:
            skill_id: Skill directory name (e.g., 'volcengine-asr')
        
        Returns:
            SkillMeta or None if not found
        """
        self._ensure_loaded()
        
        # Check cache first
        if skill_id in self._full_cache:
            return self._full_cache[skill_id]
        
        # Try to parse on demand
        skill_dir = self._skills_dir / skill_id
        if skill_dir.exists():
            meta = parse_skill_md(skill_dir)
            if meta:
                self._full_cache[skill_id] = meta
                return meta
        
        return None
    
    def get_skills_by_category(self, category: str) -> list[SkillSummary]:
        """Get all skills in a specific category.
        
        Args:
            category: Category name
        
        Returns:
            List of matching SkillSummary objects
        """
        self._ensure_loaded()
        return [s for s in self._summaries.values() if s.category == category]
    
    def get_all_categories(self) -> list[str]:
        """Get all unique categories.
        
        Returns:
            List of category names
        """
        self._ensure_loaded()
        return sorted(set(s.category for s in self._summaries.values()))
    
    def search_skills(self, keyword: str) -> list[SkillSummary]:
        """Search skills by keyword in name and description.
        
        Args:
            keyword: Search keyword (case-insensitive)
        
        Returns:
            List of matching SkillSummary objects
        """
        self._ensure_loaded()
        keyword_lower = keyword.lower()
        
        results = []
        for summary in self._summaries.values():
            if (keyword_lower in summary.name.lower() or
                keyword_lower in summary.description.lower() or
                keyword_lower in summary.id.lower()):
                results.append(summary)
        
        return results
    
    def get_skill_ids(self) -> list[str]:
        """Get all skill IDs.
        
        Returns:
            List of skill IDs
        """
        self._ensure_loaded()
        return list(self._summaries.keys())
    
    def has_skill(self, skill_id: str) -> bool:
        """Check if a skill exists.
        
        Args:
            skill_id: Skill ID to check
        
        Returns:
            True if skill exists
        """
        self._ensure_loaded()
        return skill_id in self._summaries
    
    def __len__(self) -> int:
        """Return number of registered skills."""
        self._ensure_loaded()
        return len(self._summaries)
    
    def __contains__(self, skill_id: str) -> bool:
        """Check if skill exists."""
        return self.has_skill(skill_id)
