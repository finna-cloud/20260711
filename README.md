# ARK-07 SillyTavern Extension

## 手動安裝

1. 關閉 SillyTavern。
2. 解壓縮套件。
3. 將整個 `ark07-sillytavern-extension` 資料夾放到使用者擴充目錄：
   - 新版多使用者結構：`SillyTavern/data/default-user/extensions/ark07-sillytavern-extension/`
   - 全使用者／舊版結構：`SillyTavern/public/scripts/extensions/third-party/ark07-sillytavern-extension/`
4. 重新啟動 SillyTavern，並強制重新整理瀏覽器（`Ctrl+F5`）。
5. 開啟「擴充功能 → 管理擴充功能」。
6. 確認 `ARK-07 Survival Terminal` 已啟用。
7. 進入《ARK-07｜方舟七號》聊天室，點右下角 `ARK-07`。

## 使用

- 遊戲會在同一個 SillyTavern 頁面右側開啟。
- 點擊遊戲選項推進小遊戲。
- 點「將本回合送入 SillyTavern」後，內容會填入聊天輸入框。
- 首次送出時會詢問是否立即按下 SillyTavern 的送出鍵。
- 遊戲存檔使用瀏覽器 `localStorage`。

## 找不到擴充時

- 確認資料夾內第一層就有 `manifest.json`，沒有多包一層。
- 確認檔名仍是 `manifest.json`，不是 `manifest.json.txt`。
- 查看 SillyTavern 啟動終端或瀏覽器 F12 Console 是否有載入錯誤。
- 若使用非 `default-user` 帳號，請將資料夾放到對應的 `data/<user-handle>/extensions/`。
