import { useEffect } from 'react'
import { skillsApi } from '../api/client'
import { useWorkflowStore } from '../stores/workflowStore'

export function useSkills() {
  const { skills, setSkills, categories, setCategories } = useWorkflowStore()

  useEffect(() => {
    // 加载 Skill 列表
    skillsApi.list().then((res) => setSkills(res.data))

    // 加载分类
    skillsApi.getCategories().then((res) => setCategories(res.data))
  }, [setSkills, setCategories])

  return { skills, categories }
}
