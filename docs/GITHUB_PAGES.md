# GitHub Pages 发布说明

Sphinx 源码目录是 `docs/`，不要直接把源码目录作为发布产物上传。真正可发布的是构建后的静态 HTML。

## 一键生成干净发布目录

```bash
./scripts/build_pages.sh
```

脚本会先执行 `./scripts/build_docs.sh`，再生成：

```text
docs/_build/pages/
```

这个目录就是 GitHub Pages 要上传的内容。

## 需要上传

上传 `docs/_build/pages/` 目录内的全部内容，包括：

```text
.nojekyll
*.html
searchindex.js
_static/
_images/
```

说明：

- `.nojekyll` 必须保留，否则 GitHub Pages/Jekyll 可能不服务 `_static` 和 `_images`。
- `_static/` 是 Sphinx 主题 CSS、JS、搜索脚本和自定义 CSS。
- `_images/` 是架构图和 Playwright 截图。
- `searchindex.js` 是 Sphinx 本地搜索需要的索引。

## 不需要上传

不要上传这些构建缓存或源码副本：

```text
docs/_build/html/.doctrees/
docs/_build/html/_sources/
docs/_build/html/.buildinfo
docs/_build/html/objects.inv
docs/_build/html/   # 不要整目录原样上传，使用 docs/_build/pages/
```

## 自动发布

仓库已提供 GitHub Actions workflow：

```text
.github/workflows/pages.yml
```

使用方式：

1. 在 GitHub 仓库设置中进入 `Settings -> Pages`。
2. `Build and deployment` 的 `Source` 选择 `GitHub Actions`。
3. 推送到 `main` 后，`pages` workflow 会构建 `docs/_build/pages` 并部署。
4. 也可以在 Actions 页面手动运行 `pages` workflow。

## 手动发布到 gh-pages 分支

如果不用 GitHub Actions，可以把 `docs/_build/pages/` 内容复制到 `gh-pages` 分支根目录。

示例：

```bash
./scripts/build_pages.sh
# 切到 gh-pages 分支后，把 docs/_build/pages/ 里面的内容复制到分支根目录
```

不要把 `docs/_build/pages` 这个目录本身嵌套上传；GitHub Pages 站点根目录应该直接包含 `index.html` 和 `.nojekyll`。
