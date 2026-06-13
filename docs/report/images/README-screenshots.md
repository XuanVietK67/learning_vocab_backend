# Ảnh chụp màn hình cần bổ sung (Chương 2 — Thiết kế giao diện)

Mỗi hình trong báo cáo dùng macro `\figph{<tên-file>}{...}`: chỉ cần đặt một
tệp PNG **đúng tên** dưới đây vào thư mục `images/` là hình thật sẽ thay thế
khung giữ chỗ ở lần biên dịch kế tiếp (không phải sửa file `.tex`).

## Cần chụp từ ứng dụng đang chạy (đăng nhập người học + tài khoản admin)

| Tệp ảnh (`images/`)        | Tuyến / màn hình                                   | Ghi chú |
|----------------------------|----------------------------------------------------|---------|
| `ui-dashboard.png`         | `/dashboard` (trang chủ "Trophy Room")             | Đăng nhập người học đã onboard |
| `ui-explore.png`           | `/explore` (khám phá từ vựng & bộ thẻ)             | |
| `ui-word-detail.png`       | `/words/...` hoặc chi tiết một từ                   | Mở một từ có đủ nghĩa/ví dụ/âm thanh |
| `ui-practice-write.png`    | `/practice` — chế độ luyện viết câu                 | Tốt nhất chụp lúc đã có điểm/nhận xét |
| `ui-practice-speak.png`    | `/practice` — chế độ luyện nói / phát âm            | Chụp lúc đang/đã thu âm để thấy thanh đo |
| `ui-admin-vocab.png`       | `/admin/vocabularies/[id]` (trình soạn từ vựng)    | Cần tài khoản **admin** |
| `ui-admin-review.png`      | `/admin/vocabularies/review` (hàng đợi duyệt AI)   | Cần tài khoản **admin** |

## Gợi ý chụp
- Độ rộng ~1280–1440px, tỉ lệ ngang; lưu PNG. Macro tự co theo `0.85\textwidth`.
- Nên dùng dữ liệu mẫu đã có nội dung để màn hình không trống.
- Có thể chụp toàn trang hoặc vùng nội dung chính (bỏ thanh trình duyệt).

## Nếu muốn tự dựng lại các hình đã sinh tự động
- Biểu đồ Chương 5: `python scripts/make_charts.py`
  (sinh `ch5-latency.png`, `ch5-srs-sim.png`).
- Sơ đồ PlantUML: `java -jar tools/plantuml.jar -tpng -charset UTF-8 -o images diagrams/*.puml`
  (sinh `tech-stack.png`, `srs-state-machine.png`).
