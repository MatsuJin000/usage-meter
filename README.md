# usage-meter

A Claude Code mod that keeps a usage meter above the prompt: the 5-hour window, the weekly window, the context window and the session's cost.

Claude Codeの入力欄の上に、5時間枠・週次枠・コンテキスト・費用のメーターを常時表示するmodです。

- デスクトップアプリのCodeタブ: ドーナツ型の円グラフ
- ターミナル: `○ ◔ ◑ ◕ ●` の記号(25%刻み)
- 色: 70%未満は緑、70%以上は黄、90%以上は赤
- 5時間枠と週次枠にはリセットまでの残り時間も表示します

5時間枠と週次枠はアカウント全体の値なので、最後に応答を受けたセッションの値を全セッションで共有します。新しいセッションや途中で開いたセッションでも、最初の応答を待たずに表示され、以後は1分ごとに更新されます。値が5分以上前のものなら「(12m前の値)」のように添えます。コンテキストと費用はセッションごとの値です。ほかの端末やclaude.aiのチャットで使った分は、次にこのPCのセッションが応答を受けるまで反映されません。

VS Code拡張とモバイルには表示されません。値がまだないときや、サブスクリプション以外の契約で値がないときは「—」と表示します。費用はAPI料金に換算した目安で、実際の請求額とは限りません。

## インストール

ターミナルのClaude Codeで:

```
/plugin install usage-meter --marketplace Matsujin000/usage-meter
```

`Add marketplace?` に `y` で答え、インストール先のスコープを選びます。ユーザースコープで入れると、以降に開始するセッションで有効になり、デスクトップアプリのCodeタブにも表示されます。

シェルから:

```
claude plugin install usage-meter --marketplace Matsujin000/usage-meter
```

デスクトップアプリから(`/plugin` は使えません): 入力欄の横の + をクリックし、Plugins → Add marketplace で `Matsujin000/usage-meter` を追加してから、Add plugin を選びます。
