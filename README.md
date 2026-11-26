# Canva + Gemini 8 Tuần

Ứng dụng web tĩnh bằng HTML, CSS và JavaScript để theo dõi khóa học Canva + Gemini.

## Chạy ứng dụng

Ứng dụng phải được phục vụ qua HTTP(S), không mở bằng `file://`.

```bash
python3 -m http.server 4173
```

Sau đó mở `http://localhost:4173/`.

Có thể triển khai thư mục repository trực tiếp lên bất kỳ static host nào. Không cần build tool hoặc backend.

## Cấu trúc

- `index.html`: giao diện shell, điều hướng, modals và thanh công cụ.
- `assets/app.js`: route, manifest, tiến độ, localStorage, portfolio và Firebase hook tương lai.
- `assets/style.css`: giao diện dùng chung.
- `assets/iframe-bridge.js`: thông điệp tiến độ an toàn giữa lesson iframe và shell.
- `courses/canva-gemini/manifest.json`: danh mục lesson và mapping tuần/module.
- `courses/canva-gemini/lessons/`: các trang lesson HTML.

## Thêm lesson mới

1. Giữ nguyên lesson ID đang phát hành.
2. Tạo file HTML dưới `courses/canva-gemini/lessons/` bằng tên ổn định, ví dụ `w1-d1.html`.
3. File lesson phải có `lang="vi"`, viewport metadata, `data-lesson-id` và script `../../../assets/iframe-bridge.js`.
4. File lesson có thể khai báo `LESSON_ID` và dùng `window.IframeProgressBridge.sendProgress({...})`.
5. Thêm một object lesson vào `manifest.json` với `id`, `weekId`, `weekNumber`, `moduleId`, `title`, `src`, `searchTerms` và `checklistIds`.
6. Giữ lesson iframe sandbox ở cấu hình `allow-scripts allow-same-origin`; không cho phép top navigation hoặc popup.

## Lưu dữ liệu

Ứng dụng đọc và ghi khóa localStorage chính xác:

```text
canva-gemini-course:v1
```

Dữ liệu cũ được giữ lại và chuyển sang progress wrapper khi cần. Các thay đổi được gom trong 700 ms trước khi ghi. Unknown fields của dữ liệu cũ/import được giữ lại khi có thể. Không lưu tệp ảnh/PDF; portfolio chỉ lưu URL HTTP/HTTPS.

## Firebase trong tương lai

`window.courseAppHooks.saveProgress(progress)` và `loadProgress()` là điểm tích hợp duy nhất. Phiên bản hiện tại dùng localStorage. Firebase SDK, API key, Cloud Functions và Firebase Storage không được tích hợp trong PR này.
