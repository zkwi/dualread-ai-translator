# 项目文档

这里区分“当前说明”和“历史设计记录”，避免旧实施方案被误认为现行行为。

## 当前说明

- [架构说明](architecture.md)：运行时组件、正文流式链路、Thinking 探测、缓存和兼容边界。
- [开发与验证](development.md)：本地开发、测试命令、真实页面验证和发布检查。
- [真实页面清单](../test-pages.md)：BBC、CNN、Reddit、X、Quora 等页面的手工验收点。

## 架构决策

- [ADR-0001：结构感知的翻译布局适配层](adr/0001-structure-aware-translation-layout.md)
- [ADR-0002：通过连接测试探测 Thinking 控制能力](adr/0002-detect-thinking-capability-during-api-test.md)

## 历史设计与计划

`superpowers/specs/` 和 `superpowers/plans/` 保存各版本形成时的设计与实施记录。它们用于追溯决策，不代表当前使用说明；现行行为以上面的架构说明和代码为准。
