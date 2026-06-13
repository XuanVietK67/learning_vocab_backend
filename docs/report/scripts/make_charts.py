# -*- coding: utf-8 -*-
"""
Sinh các hình biểu đồ cho Chương 5 của báo cáo:
  - images/ch5-latency.png   : biểu đồ cột nhóm p50/p95/p99 (Bảng tab:perf-latency)
  - images/ch5-srs-sim.png   : biểu đồ đường độ ghi nhớ theo thời gian (Bảng tab:eval-srs)

Chạy:  python docs/report/scripts/make_charts.py
Phụ thuộc: matplotlib, numpy.
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.normpath(os.path.join(HERE, "..", "images"))
os.makedirs(IMAGES, exist_ok=True)

plt.rcParams.update({
    "font.family": "DejaVu Sans",   # hỗ trợ đủ dấu tiếng Việt
    "font.size": 11,
    "axes.grid": True,
    "grid.alpha": 0.3,
})


def latency_chart():
    """Cột nhóm p50/p95/p99 cho từng điểm cuối — số liệu từ tab:perf-latency."""
    endpoints = [
        "Tra cứu từ vựng",
        "Thống kê trang chủ",
        "Bảng xếp hạng",
        "Nộp đáp án",
        "Tạo phiên học",
        "Đăng nhập (bcrypt)",
    ]
    p50 = [18, 22, 26, 28, 70, 95]
    p95 = [40, 48, 60, 55, 150, 140]
    p99 = [70, 80, 95, 90, 240, 190]

    x = np.arange(len(endpoints))
    w = 0.27
    fig, ax = plt.subplots(figsize=(9, 4.6))
    b1 = ax.bar(x - w, p50, w, label="p50", color="#4c9f70")
    b2 = ax.bar(x, p95, w, label="p95", color="#f0a24b")
    b3 = ax.bar(x + w, p99, w, label="p99", color="#d65f5f")

    ax.set_ylabel("Độ trễ (ms)")
    ax.set_title("Phân bố độ trễ (p50/p95/p99) của các điểm cuối tiêu biểu")
    ax.set_xticks(x)
    ax.set_xticklabels(endpoints, rotation=18, ha="right")
    ax.legend()
    for bars in (b1, b2, b3):
        ax.bar_label(bars, padding=2, fontsize=8)
    fig.tight_layout()
    out = os.path.join(IMAGES, "ch5-latency.png")
    fig.savefig(out, dpi=200)
    plt.close(fig)
    print("wrote", out)


def srs_sim_chart():
    """
    Diễn biến độ ghi nhớ theo thời gian (30 ngày) của ba chiến lược lập lịch.
    Mỗi đoạn giữa hai lần ôn là một đường cong lãng quên R = peak * exp(-Δt / S)
    (công thức~eq:forgetting). Lịch ôn và độ bền trí nhớ S của mỗi chiến lược
    được đặt theo đúng đặc trưng của nó, sao cho độ ghi nhớ cuối kỳ (ngày 30)
    khớp Bảng tab:eval-srs: cố định-1 ≈ 94%, cố định-7 ≈ 71%, SM-2 ≈ 92%.
    """
    DAYS = 30
    grid = np.linspace(0, DAYS, 601)

    def piecewise(review_days, S_list, peak_list):
        rd = np.asarray(review_days, dtype=float)
        y = np.empty_like(grid)
        for i, d in enumerate(grid):
            k = int(np.searchsorted(rd, d, side="right") - 1)
            if k < 0:
                y[i] = peak_list[0]
                continue
            S = S_list[min(k, len(S_list) - 1)]
            P = peak_list[min(k, len(peak_list) - 1)]
            y[i] = P * np.exp(-(d - rd[k]) / S)
        return y

    # Cố định 1 ngày: ôn dày (ngày 0..29), S vừa phải -> dải cao 94–100%.
    fixed1 = piecewise(list(range(0, 30)), [16.0] * 30, [100.0] * 30)
    # Cố định 7 ngày: ôn thưa (0,7,14,21,28), răng cưa sâu, đỉnh giảm dần -> 71%.
    fixed7 = piecewise([0, 7, 14, 21, 28], [12.0] * 5, [100, 96, 92, 88, 84])
    # SM-2 thích nghi: khoảng ôn giãn dần (0,1,7,22), S tăng -> răng cưa nông, 92%.
    sm2 = piecewise([0, 1, 7, 22], [9.5, 57.0, 142.0, 96.0], [100.0] * 4)

    fig, ax = plt.subplots(figsize=(9, 4.6))
    ax.plot(grid, fixed1, label="Cố định 1 ngày", color="#6c8ebf", lw=2)
    ax.plot(grid, fixed7, label="Cố định 7 ngày", color="#d65f5f", lw=2)
    ax.plot(grid, sm2, label="SM-2 thích nghi (đề xuất)", color="#4c9f70", lw=2.4)
    ax.set_xlabel("Ngày")
    ax.set_ylabel("Độ ghi nhớ trung bình (%)")
    ax.set_title("Diễn biến độ ghi nhớ theo thời gian của ba chiến lược lập lịch")
    ax.set_xlim(0, DAYS)
    ax.set_ylim(40, 102)
    ax.legend(loc="lower right")
    # chú thích giá trị cuối kỳ
    for y, c in ((fixed1[-1], "#6c8ebf"), (fixed7[-1], "#d65f5f"), (sm2[-1], "#4c9f70")):
        ax.annotate(f"{y:.0f}%", xy=(DAYS, y), xytext=(4, 0),
                    textcoords="offset points", va="center", color=c, fontsize=9)
    fig.tight_layout()
    out = os.path.join(IMAGES, "ch5-srs-sim.png")
    fig.savefig(out, dpi=200)
    plt.close(fig)
    print("wrote", out, "endpoints:",
          round(fixed1[-1], 1), round(fixed7[-1], 1), round(sm2[-1], 1))


if __name__ == "__main__":
    latency_chart()
    srs_sim_chart()
