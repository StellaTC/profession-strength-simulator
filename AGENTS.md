# 阵容战斗模拟器
本目录是独立原生 macOS 工程，不依赖旧模拟器运行目录。
交付物放 outputs/，临时和验证中间文件放 work/。
禁止提交 SQLite、用户数据、运行时二进制、target/ 或 .app 产物。游戏快照和内置模板在 resources/，属于构建输入。
Rust 战斗核心在 engine/，角色初始化适配器在 adapter/。更改引擎须通过三支48小时真实队伍回归和归因守恒测试。
资源路径必须基于 .app/Contents/Resources；源码路径只供开发运行回退。
