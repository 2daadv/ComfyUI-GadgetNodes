# ComfyUI-GadgetNodes

ComfyUI 向けのカスタムノード集です。プロンプト編集・翻訳、モデルプリセット管理、画像前処理、LoRA/Checkpoint メタデータ編集、学習用タグ編集など、日常のワークフローを補助するユーティリティノードを提供します。

## インストール

1. ComfyUI の `custom_nodes` フォルダに本リポジトリをクローンします。

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/2daadv/ComfyUI-GadgetNodes.git
```

2. 依存パッケージをインストールします。

```bash
pip install -r ComfyUI-GadgetNodes/requirements.txt
```

3. ComfyUI を再起動します。ノードはメニューの `Gadget/` カテゴリ以下に表示されます。

## ComfyUI Nodes 2.0 について

本パッケージの一部ノードは、`js/` 以下のフロントエンド拡張（`beforeRegisterNodeDef`、`addDOMWidget`、カスタムモーダル UI、キャンバス操作など）に依存しています。これらは **ComfyUI の従来 UI（LiteGraph ベース）向け** に実装されており、**Nodes 2.0（新フロントエンド）では正常に動作しない可能性** があります。

| ノード | JS 依存の内容 | Nodes 2.0 での懸念 |
|---|---|---|
| **Translate Prompt** | `Ctrl+Enter` による即時翻訳、実行結果の UI 反映、サブグラフ連携 | ショートカット翻訳や UI 更新が効かない可能性。キュー実行自体は Python 側で動作 |
| **Prompt Palette** | ツリー UI（`addDOMWidget`）、YAML 編集ボタン | カスタム UI が表示・操作できない可能性 |
| **Load Checkpoint Preset** | モデル選択時の `models_config.yaml` 自動反映 | プリセット自動入力が効かない可能性。出力値の手動設定は可能 |
| **Edit SD Lora Information** | メタデータ読込・Save ボタン、サムネイル描画 | 編集 UI・保存ボタン・プレビューが使えない可能性 |
| **Edit SD Checkpoint Information** | 同上 | 同上 |
| **Crop Images (Manual)** | 実行時のクロップダイアログ（モーダル UI） | **ダイアログが開かず実行が完了しない可能性が高い** |
| **Select Image Indices** | 実行時の画像選択ダイアログ | **同上** |
| **Edit Train Tags** | タグ編集 UI（`addDOMWidget`）、Save 操作 | カスタム UI が表示・操作できない可能性 |
| **Virtual Group** | キャンバス上のノード折りたたみ/展開 | グループ化 UI が動作しない可能性。ワークフロー実行への影響はなし |

JS 拡張を使わないノード（**Normalize Prompt**、**Split Prompt**、**Load Images From Folder** など）は、Nodes 2.0 でも概ね問題なく利用できる想定です。Nodes 2.0 利用時は、上記ノードの動作を個別に確認してください。

## 依存関係

| パッケージ | 用途 |
|---|---|
| `dynamicprompts` | **Expand Wildcards** のワイルドカード展開 |
| `requests` | **Translate Prompt**（Ollama / Google 翻訳）、各種 API 通信 |
| `PyYAML` | 設定ファイル・プロンプトパレットの読み込み（ComfyUI 本体に同梱されている場合が多い） |

### オプション（Translate Prompt）

- **Ollama**: ローカル LLM による翻訳。Ollama を起動し、`completion` 対応モデルをインストールしておくと、ノードの `translation_engine` に自動で一覧表示されます。
- **Google**: 外部翻訳 API（インターネット接続が必要）。Ollama が使えない場合の代替です。

## 設定ファイル

以下のファイルはリポジトリ直下（`ComfyUI-GadgetNodes/`）に **ユーザー自身で作成** します。初回は存在しなくても動作しますが、対応ノードの機能が制限されます。

### `models_config.yaml`（Load Checkpoint Preset 用）

モデル名（正規表現）に応じて VAE・CLIP・サンプラー設定・デフォルトプロンプトなどを自動適用します。`Load Checkpoint Preset` ノードで `model_name` を選ぶと、このファイルの内容が UI に反映されます。

```yaml
# __keywords__ は positive / negative 内のプレースホルダ置換に使います
__keywords__:
  "{quality}": "masterpiece, best quality"
  "{neg}": "lowres, bad anatomy, blurry"

# キーは model_name に対する正規表現
"SDXL.*":
  vae_name: "sdxl_vae.safetensors"
  clip_name: "None"
  clip_type: "stable_diffusion"
  clip_skip: -2
  steps: 30
  cfg: 7.0
  sampler_name: "euler"
  scheduler: "normal"
  positive: "{quality}, 1girl, standing"
  negative: "{neg}"

"flux.*":
  vae_name: "ae.safetensors"
  clip_name: "t5xxl_fp16.safetensors"
  clip_type: "flux"
  clip_skip: -2
  steps: 20
  cfg: 1.0
  sampler_name: "euler"
  scheduler: "simple"
  positive: "a photo of a cat"
  negative: ""
```

**複数パターンへのマッチ（フォールスルー）**

モデル名が複数の正規表現に同時にマッチする場合、YAML 内の**記述順**に従って順番にマージされます。同じキーが複数パターンで定義されているときは、**先にマッチしたパターンの値が優先**され、後からマッチしたパターンは**まだ未設定のキーだけ**を補完します。

この性質を利用すると、switch の fall-through のように設定を積み重ねできます。

- **手前（先）**: モデル固有・優先したい設定
- **後ろ（後）**: 汎用的なデフォルト（`".*"` など、未設定項目の穴埋め用）

例: モデル名 `SDXL_anime_v1.safetensors` が `"SDXL_anime.*"` と `".*"` の両方にマッチする場合

```yaml
"SDXL_anime.*":
  steps: 20
  positive: "{quality}, anime style"
  negative: "{neg}"

".*":
  vae_name: "sdxl_vae.safetensors"
  clip_skip: -2
  steps: 30
  cfg: 7.0
  sampler_name: "euler"
  scheduler: "normal"
```

→ `steps` は先にマッチした `20` が使われ、`vae_name` や `cfg` など未設定だった項目は後方の `".*"` から補完されます。`preset_name` 出力には、実際に値を提供したパターン名がカンマ区切りで表示されます。

### `train_config.yaml`（Edit Train Tags 用）

学習データセットのタグ編集 UI の動作を調整します。

```yaml
# マスク画像のファイル名サフィックス（一覧から除外されます）
mask_image_postfix: "-masklabel.png"

# タグ編集 UI でブラックリストとして扱うタグ
black_list_tag:
  - "lowres"
  - "bad anatomy"
  - "worst quality"
```

### `prompt/*.yaml`（Prompt Palette 用）

`prompt/` フォルダ内の YAML ファイルが **Prompt Palette** のドロップダウンに表示されます。ネストした辞書構造でカテゴリ分けし、葉ノードの値がプロンプト文字列になります。

`prompt/example.yaml` の例:

```yaml
Character:
  Female:
    Casual: "1girl, casual clothes, smile, looking at viewer"
    Formal: "1girl, formal dress, elegant pose"
  Male:
    Casual: "1boy, casual clothes, relaxed expression"
Background:
  Outdoor: "outdoor, sunny day, blue sky, nature"
  Indoor: "indoor, cozy room, warm lighting"
Quality:
  Base: "masterpiece, best quality, highly detailed"
```

ツリー上の項目をクリックすると右側のテキストエリアにプロンプトが表示されます。**Edit YAML File** ボタンで OS の既定エディタから直接編集できます。

### ワイルドカードファイル（Expand Wildcards 用）

**Expand Wildcards** は [dynamicprompts](https://github.com/adamantite/dynamicprompts) 形式のワイルドカードを展開します。次のいずれかにワイルドカード定義を置きます（優先順）:

1. `ComfyUI/wildcards/`（存在する場合）
2. `ComfyUI-GadgetNodes/wildcards/`（自動作成）

例: `ComfyUI/wildcards/colors.txt`

```text
red
blue
green
yellow
```

プロンプト内で `{__colors__}` のように参照します。

---

## ノード一覧

### Gadget / prompt

| ノード | 説明 |
|---|---|
| **Normalize Prompt** | コメント（`/* */`, `<!-- -->`, `#`）除去、改行の正規化、カンマ・空白の整理を行い、1 行のプロンプトに整形します。 |
| **Translate Prompt** ⚠️ | 日本語などの入力を英語プロンプトに翻訳します。`「…」` で囲まれた部分のみ翻訳するモードにも対応。`Ctrl+Enter`（Mac は `Cmd+Enter`）で UI 上から即時翻訳できます。 |
| **Analyze Prompt** | プロンプトを解析します。`☹` が含まれると `facedetailer_enabled` を `True` にし、該当タグを除去します。特定の NSFW 関連語句がある場合、`explicit` / `uncensored` を自動付与します。 |
| **Split Prompt** | ポジティブ/ネガティブを分離します。`, -(tag)` 形式をネガティブとして抽出し、残りをポジティブとして出力します。 |
| **Expand Wildcards** | dynamicprompts 形式のワイルドカードを組み合わせ展開し、プロンプトのリストを生成します。`max_variations` で上限、`auto_refresh` でファイル変更の再読み込みを制御します。 |
| **Prompt To FileName** | プロンプトから保存用ファイル名を生成します。`%time`（`time_format` で書式指定）と `%prompt` プレースホルダに対応。 |
| **Prompt Palette** ⚠️ | `prompt/*.yaml` をツリー UI で閲覧・選択するパレット。設定ファイルは上記「`prompt/*.yaml`」を参照。 |

#### Split Prompt の記法例

```text
1girl, smile, -(lowres), -(bad anatomy:1.2), standing
```

→ positive: `1girl, smile, standing` / negative: `(lowres), (bad anatomy:1.2)`

---

### Gadget / core

| ノード | 説明 |
|---|---|
| **Any Print** | 任意型の値をコンソール（ComfyUI ログ）に再帰的に出力します。デバッグ用。 |
| **Select Input Folder** | ComfyUI の `input` 配下フォルダを選択し、パス文字列を出力します。 |

#### Gadget / core / const

定数 INT 値を出力するノード群: **0**, **1**, **-1**, **64**, **256**, **512**, **1024**

---

### Gadget / logic

| ノード | 説明 |
|---|---|
| **Any Pass** | 入力値をany型に変換して出力するパススルー。 |
| **++1** / **--1** | INT 値を ±1 します。 |
| **Int Equals** / **Int Not Equals** | INT の等値 / 非等値を BOOLEAN で返します。 |
| **Int Nearly Equals** / **Float Nearly Equals** | 近似等値判定（INT は差 ±1 以内、FLOAT は `math.isclose`）。 |
| **Select Nth Items Of AnyList** | リストから指定インデックスの要素を選択します。負のインデックスで末尾から参照可能。範囲外は省略。 |
| **Virtual Group** ⚠️ | 指定したノード ID（例: `1-3, 6, 9-13`）またはタイトル（ワイルドカード `*` 可）を折りたたみ/展開して、キャンバス上の見た目を整理します。実行時の動作は変えません。 |

---

### Gadget / model

| ノード | 説明 |
|---|---|
| **Load Checkpoint Preset** ⚠️ | モデル名に応じた各種設定を出力するプリセットローダー。`models_config.yaml` の内容を UI に自動反映します。 |
| **Load Checkpoint or Diffusion Model** | Checkpoint と Diffusion Model の両方に対応した統合ローダー。Diffusion Model 使用時は `clip_name` と `vae_name` が必須です。 |
| **Edit SD Lora Information** ⚠️ | LoRA ファイル横の `.json` メタデータ（説明、activation text、推奨 weight など）を UI で編集・保存します。 |
| **Edit SD Checkpoint Information** ⚠️ | Checkpoint / Diffusion Model 横の `.json` メタデータ（説明、notes、推奨 VAE）を UI で編集・保存します。 |

#### LoRA サイドカー JSON の例

`models/loras/my_lora.safetensors` と同じ場所に `my_lora.json` を置きます（ノード UI からも作成・保存可能）:

```json
{
    "description": "Anime style LoRA",
    "sd version": "SDXL",
    "activation text": "my_style",
    "preferred weight": 0.8,
    "negative text": "lowres",
    "notes": "Weight 0.6-1.0 recommended"
}
```

#### Checkpoint サイドカー JSON の例

```json
{
    "description": "SDXL base model",
    "notes": "Use with sdxl_vae",
    "vae": "sdxl_vae.safetensors"
}
```

---

### Gadget / image

| ノード | 説明 |
|---|---|
| **Crop Images (Manual)** ⚠️ | 画像リストに対し、UI ダイアログで手動クロップ領域を指定します。アスペクト比プリセット（4:5, 1:1, 16:9 など）に対応。 |
| **Load Images From Folder** | フォルダから画像を一括読み込みします。正規表現フィルタ、件数上限、再帰探索に対応。 |
| **Select Image Indices** ⚠️ | 画像リストをプレビュー UI で表示し、選択したインデックス（カンマ区切り文字列）を出力します。 |
| **Smart Resize Images** | 目標ピクセル数・倍数制約に基づきリサイズ/クロップします。歪み閾値を超える場合はクロップでアスペクト比を維持。 |
| **Refine Images** | メディアンフィルタ、デノイズ、ガウシアン AA、シャープンを組み合わせた後処理。 |

---

### Gadget / train

| ノード | 説明 |
|---|---|
| **Edit Train Tags** ⚠️ | 学習用画像フォルダのタグ（`.txt`）を UI で編集します。keep/remove タグの整理、マスク画像プレビュー、ドラッグ&ドロップでのタグ並べ替えに対応。`train_config.yaml` でマスクファイル名やブラックリストタグを設定できます。 |

#### データセットの想定レイアウト

```text
dataset/
  image001.png
  image001.txt          # カンマ区切りタグ
  image001-masklabel.png  # オプション（train_config.yaml の mask_image_postfix に合わせる）
  image002.jpg
  image002.txt
```

---

⚠️ = [ComfyUI Nodes 2.0 について](#comfyui-nodes-20-について) を参照。

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照してください。
