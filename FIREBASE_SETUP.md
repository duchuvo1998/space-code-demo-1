# Hướng dẫn bật Firebase progress sync

Ứng dụng lưu Firebase Web App config công khai trong `assets/firebase/firebase-config.js`. Trình duyệt luôn có thể xem các giá trị này; không đặt service-account key, private key, mật khẩu hoặc token vào mã frontend.

## 1. Tạo Firebase project và Web App

1. Tạo project tại [Firebase Console](https://console.firebase.google.com/).
2. Trong **Project settings → General → Your apps**, thêm một ứng dụng Web.
3. Sao chép cấu hình Web App mà Firebase Console cung cấp vào `firebaseConfig` trong `assets/firebase/firebase-config.js`. Đây là client config công khai và sẽ hiển thị trong mã tải xuống trình duyệt.

## 2. Bật Google Sign-In

1. Mở **Authentication → Sign-in method**.
2. Bật provider **Google** và chọn support email.
3. Trong **Authentication → Settings → Authorized domains**, thêm:
   - `duchuvo1998.github.io` để dùng trang GitHub Pages.
   - `localhost` để thử nghiệm trên máy cá nhân.

Nếu web được phục vụ từ domain khác, domain đó cũng phải được thêm vào danh sách.

## 3. Tạo Firestore và publish rules

1. Mở **Firestore Database** và tạo database ở **Production mode**. Chọn location phù hợp vì vị trí database thường không đổi được sau khi tạo.
2. Vào tab **Rules**, thay nội dung hiện tại bằng nội dung trong [`firestore.rules.txt`](firestore.rules.txt), rồi bấm **Publish**.
3. Rules giới hạn quyền đọc/ghi vào `users/{uid}/course/progress`: người dùng chỉ truy cập dữ liệu có UID trùng với tài khoản Google đang đăng nhập. Không mở quyền đọc/ghi cho toàn bộ database.

Ứng dụng không dùng Cloud Functions, Firebase Storage hoặc realtime listener.

## 4. Chạy thử

Chạy dev server local có live reload:

```bash
python3 dev-server.py
```

Mở `http://localhost:4173/`, đăng nhập Google, rồi thay đổi checklist hoặc ghi chú. Trạng thái trên thanh đầu trang sẽ báo đồng bộ. Trong Firestore Console, kiểm tra document:

```text
users/{uid}/course/progress
```

`uid` là UID của tài khoản Firebase Authentication. Web vẫn chạy bằng `localStorage` khi chưa cấu hình Firebase hoặc khi người dùng chưa đăng nhập. Payload đồng bộ bị giới hạn ở 900 KB.

## 5. Đưa lên GitHub Pages

Pages hiện publish trực tiếp từ thư mục gốc của nhánh `main`. Các thay đổi trong `feature/firebase-progress-sync` chưa xuất hiện trên web cho đến khi được merge vào `main`. Sau khi merge và Pages deploy xong:

1. Xác nhận `firestore.rules.txt` đã được publish trong đúng Firebase project.
2. Trong **Authentication → Settings → Authorized domains**, thêm domain GitHub Pages.
3. Mở trang Pages, đăng nhập và thử lưu một thay đổi.

Firebase Web config nằm trong mã nguồn và sẽ công khai trên GitHub Pages. Không đưa service-account key vào repository, GitHub Actions hoặc web client.

## Đồng bộ dữ liệu và reset

- Dữ liệu luôn được ghi vào `localStorage` trước khi gửi lên Firestore.
- Nếu Firestore chưa có tiến độ, lần đăng nhập đầu tiên đưa tiến độ local lên cloud.
- Nếu Firestore đã có dữ liệu, ứng dụng gộp các trường; sau lần đồng bộ đầu, mỗi trình duyệt lưu một baseline để gửi chính xác các thay đổi và mục đã xóa.
- Với trình duyệt chưa từng đồng bộ, ứng dụng không thể biết một mục local vắng mặt là bị xóa hay chưa từng tồn tại; các mục cloud vẫn được giữ khi gộp lần đầu.
- Khi đăng nhập Google và xác nhận **Đặt lại**, tiến độ của tài khoản đó cũng được đặt lại. Hãy dùng **Xuất JSON** để sao lưu trước.

## Xử lý lỗi thường gặp

- **Nút đăng nhập không xuất hiện:** kiểm tra cấu hình trong `assets/firebase/firebase-config.js` và tải lại trang.
- **`auth/unauthorized-domain`:** thêm domain hiện tại vào **Authentication → Settings → Authorized domains**.
- **`permission-denied` / `Missing or insufficient permissions`:** kiểm tra Firestore rules đã publish vào đúng project và người dùng đã đăng nhập.
- **Vẫn thấy “Chỉ lưu trên thiết bị”:** chưa cấu hình Firebase hoặc chưa đăng nhập; dữ liệu vẫn nằm trong `localStorage` của trình duyệt đó.
- **Không thể đồng bộ dữ liệu lớn:** giảm dữ liệu tiến độ xuống dưới giới hạn 900 KB.
