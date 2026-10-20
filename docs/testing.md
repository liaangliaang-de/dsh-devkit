# 测试与复现

## 不调用模型的CI/单元检查

```sh
npm ci --ignore-scripts
npm run build
npm test
npm pack
```

单元检查中的执行结果夹具不作为真实宿主成功。CI不保存DSH账户凭据，也不发模型请求。

## 真实DSH原生工具检查（Windows，可选）

安装本机DSH后，设置一个专用测试目录，先用宿主CLI将本地tgz安装到该隔离目录的sdk profile；不要使用现用DSH_HOME。测试脚本不复制生产凭据，并挂载拒绝所有llm/stream的测试插件。需要系统中可用的Node.js与PowerShell。

```powershell
$env:DSH_TEST_HOME = Join-Path $env:TEMP 'dsh-devkit-test-home'
$env:DSH_INSTALLATION = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness'
$env:DSH_HOME = $env:DSH_TEST_HOME
# 使用本机DSH自带CLI，在专用sdk profile安装构建的tgz；具体CLI路径依安装目录。
# dsh plugin --profile sdk add ./dsh-devkit-0.2.7.tgz --offline --ignore-scripts
npm run test:native
```

默认在新临时项目运行23项原生状态/编辑/事件检查，不执行浏览器或模型。显式 `npm run test:native -- --browser-full` 才在隔离目录使用danger-full-access并加入生成器和浏览器检查，共25项；浏览器仍以宿主真实回执判定。这不切换现用桌面profile权限。

可选 `DSH_TEST_PROFILE` 指定专用测试profile。报告默认在仓库 `.test-output/`，包含临时目录和执行细节，不能直接公开。测试目录留下状态/证据供检查，不自动删除用户目录。

完整压缩、记忆、技能、团队、审核和视觉语义组合需要另外设计同题/同预算模型实验和明确额度，不属于CI。此仓库没有自动消耗模型额度的公开脚本。
