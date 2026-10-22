# v1.0.2 — WPS 表单支持 / WPS Forms support

## 中文

**新增**

- 支持 **WPS 表单**（`f.wps.cn/ksform/w/write/...`）：
  - 按 `.ksapc-questions-write-container` 识别题目；
  - 单选 / 多选（antd `ant-radio-wrapper` / `ant-checkbox-wrapper`）；
  - 填空、长文本（`ant-input` / `textarea`）；
  - 下拉题：自动展开 `ant-select-dropdown`，按选项文字选择。
- 识别 WPS 表单的“需要登录 WPS”状态和“已停止收集”提示，逐题标记，不猜答案。

**优化**

- 题目列表去掉开头的必填星号 `*` 和题号，显示更干净。
- `fillAll({ adapter })` 可指定适配器，便于调试。

**已知限制**

- WPS 表单的日期题、省/市/区题、文件上传题仍需手动填写。
- 收集上限已满 / 已关闭的表单任何人都填不了，脚本不会绕过。

## English

**Added**

- **WPS Forms** support (`f.wps.cn/ksform/w/write/...`):
  - questions are read from `.ksapc-questions-write-container`;
  - radios / checkboxes via antd wrappers;
  - text inputs and textareas;
  - dropdowns: opens `ant-select-dropdown` and picks by option text.
- Detects WPS Forms that require a WPS login or have stopped collecting, and marks them instead of guessing.

**Changed**

- Question titles are cleaned (leading `*` and numbering removed).
- `fillAll({ adapter })` can force an adapter for debugging.

**Known limitations**

- Date, region and file-upload questions on WPS Forms remain manual.
- Forms that reached their collection limit or were closed cannot be filled by anyone; the script does not bypass that.

**Install**

```
https://raw.githubusercontent.com/<owner>/<repo>/main/survey-autofill-helper.user.js
```
