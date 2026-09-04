GitHub Pages 发布
=================

发布模型
--------

Sphinx 源码位于 ``docs/``，GitHub Pages 不直接发布源码或 ``docs/_build/html``。
标准流程是：

1. ``scripts/build_pages.sh`` 构建并筛选静态站点。
2. ``actions/upload-pages-artifact`` 上传 ``docs/_build/pages``。
3. ``actions/deploy-pages`` 通过 ``github-pages`` Environment 发布。

本地生成：

.. code-block:: bash

   ./scripts/build_pages.sh

产物根目录必须直接包含 ``index.html`` 和 ``.nojekyll``，并包含 ``_static/``、
``_images/``、其他 HTML 页面和 ``searchindex.js``。构建缓存、``_sources/``、
``.buildinfo`` 和 ``objects.inv`` 不进入发布 artifact。

仓库设置
--------

自动发布需要以下远端设置：

1. 进入 ``Settings -> Pages``。
2. 将 ``Build and deployment -> Source`` 设为 ``GitHub Actions``。
3. 进入 ``Settings -> Environments -> github-pages``。
4. 在 ``Deployment branches and tags`` 中选择 ``Selected branches and tags``，添加精确
   分支 ``main``。也可以选择 ``No restriction``，但只允许 ``main`` 的边界更清晰。

``.github/workflows/pages.yml`` 使用 GitHub 官方 ``github-pages`` Environment 和 OIDC
权限。分支是否允许部署属于仓库远端设置，不能在 workflow YAML 中声明。不要为了绕过
保护规则而删除 ``environment: github-pages``。

Environment 拒绝部署
---------------------

如果 ``Build Pages artifact`` 成功，而部署 job 报错：

.. code-block:: text

   Branch "main" is not allowed to deploy to github-pages due to environment protection rules.

这表示 Sphinx 和 Pages artifact 已成功，失败点只有 ``github-pages`` Environment 的分支
规则。按上一节允许 ``main``，然后在失败的 Actions run 中选择
``Re-run failed jobs``。不需要改 Sphinx、重新生成截图或切换发布分支。

部署成功后的浏览器验收
------------------------

``pages`` workflow 的 ``verify`` job 会在 ``Deploy Pages`` 成功后自动启动
Chromium，访问 deployment job 输出的 ``page_url``，逐页检查 HTTP 200、非空标题和
正文，并在 ``behavior_tree_basics.html`` 中断言序列、选择、装饰、并行以及
``ReactiveSequence``/``ReactiveFallback``、``PrioritySelector``、``TickRate`` 等
节点语义仍然存在。这样 ``Deploy`` 变绿不仅代表 artifact 上传完成，也代表发布站点
可访问且关键设计说明没有被构建筛选遗漏。

本地复现同一检查：

.. code-block:: bash

   cd bt_editor
   npm ci
   npx playwright install chromium
   BT_PAGES_URL=https://lovelyyoshino.github.io/behavior_tree_cpp npm run verify:pages

如果仓库使用自定义域名，只需替换 ``BT_PAGES_URL``；脚本会去掉末尾斜杠并以非零状态
码报告任一页面、标题、正文或关键节点术语缺失。

备用分支模式
------------

只有在 ``Settings -> Pages`` 将 Source 明确改为 ``Deploy from a branch`` 后，才使用
``gh-pages`` 分支。先运行 ``./scripts/build_pages.sh``，再把
``docs/_build/pages/`` **内部内容** 放到 ``gh-pages`` 根目录。

GitHub Actions 和 ``gh-pages`` 分支模式二选一。当前仓库的标准模式是 GitHub Actions。
