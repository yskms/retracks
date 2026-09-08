"""操作アイコンの生成。

同じ形状データから、ウィジェット用のベクタ（Android）とアプリ用の PNG を作る。
角を丸める処理をここに置くことで、両方の丸みが必ず一致する。
"""
import io, math
from PIL import Image, ImageDraw

# ---- 形状（24x24 の座標系。時計回り） --------------------------------------

# リピート：Material の角ばったループと同じ骨格。
# 元は時計回り（上の矢印が右向き）なので、左右を反転して反時計回りにする。
# 数字の「1」は反転させない（裏返ってしまうため）。
LOOP = [
    [(7, 7), (17, 7), (17, 10), (21, 6), (17, 2), (17, 5), (5, 5), (5, 11), (7, 11)],
    [(17, 17), (7, 17), (7, 14), (3, 18), (7, 22), (7, 19), (19, 19), (19, 13), (17, 13)],
]
ONE = [(13, 15), (13, 9), (12, 9), (10, 10), (10, 11), (11.5, 11), (11.5, 15)]

# 端から端まで：両端の壁と、外向きの矢印
SPAN = [
    [(3.0, 5.6), (5.4, 5.6), (5.4, 18.4), (3.0, 18.4)],
    [(18.6, 5.6), (21.0, 5.6), (21.0, 18.4), (18.6, 18.4)],
    [(6.9, 12), (11.0, 8.2), (11.0, 15.8)],
    [(17.1, 12), (13.0, 8.2), (13.0, 15.8)],
    [(10.4, 10.8), (13.6, 10.8), (13.6, 13.2), (10.4, 13.2)],
]


def _round_corners(poly, r):
    """各頂点を半径 r で丸める。辺が短い場合はその辺に収まるまで縮める。"""
    n = len(poly)
    out = []
    for i in range(n):
        prev, cur, nxt = poly[i - 1], poly[i], poly[(i + 1) % n]
        d1 = math.dist(prev, cur)
        d2 = math.dist(cur, nxt)
        rr = min(r, d1 / 2, d2 / 2)
        u1 = ((prev[0] - cur[0]) / d1, (prev[1] - cur[1]) / d1)
        u2 = ((nxt[0] - cur[0]) / d2, (nxt[1] - cur[1]) / d2)
        a = (cur[0] + u1[0] * rr, cur[1] + u1[1] * rr)
        b = (cur[0] + u2[0] * rr, cur[1] + u2[1] * rr)
        out.append((a, cur, b))
    return out


def to_path(poly, r):
    """SVG / VectorDrawable の pathData を作る。"""
    c = _round_corners(poly, r)
    f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")
    parts = [f"M{f(c[0][0][0])},{f(c[0][0][1])}"]
    for a, p, b in c:
        parts.append(f"L{f(a[0])},{f(a[1])}")
        parts.append(f"Q{f(p[0])},{f(p[1])} {f(b[0])},{f(b[1])}")
    parts.append("Z")
    return "".join(parts)


def to_points(poly, r, steps=10):
    """PIL で塗るための頂点列。曲線は折れ線に分解する。"""
    pts = []
    for a, p, b in _round_corners(poly, r):
        pts.append(a)
        for i in range(1, steps + 1):
            t = i / steps
            m = (1 - t)
            pts.append((m * m * a[0] + 2 * m * t * p[0] + t * t * b[0],
                        m * m * a[1] + 2 * m * t * p[1] + t * t * b[1]))
    return pts


def write_vector(path, shapes, tint="#FFFFFF"):
    body = "\n".join(
        f'  <path android:fillColor="{tint}"\n      android:pathData="{to_path(poly, r)}"/>'
        for poly, r in shapes
    )
    io.open(path, "w", encoding="utf-8").write(
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="24dp" android:height="24dp"\n'
        '    android:viewportWidth="24" android:viewportHeight="24"\n'
        f'    android:tint="{tint}">\n' + body + "\n</vector>\n"
    )
    print(path)


def write_png(path, shapes, out=96, ss=8):
    n = out * ss
    k = n / 24.0
    im = Image.new("RGBA", (n, n), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    for poly, r in shapes:
        d.polygon([(x * k, y * k) for x, y in to_points(poly, r)], fill=(255, 255, 255, 255))
    im.resize((out, out), Image.LANCZOS).save(path)
    print(path)


def mirror(poly):
    """x = 12 を軸に左右を反転する。回転の向きが逆になる。"""
    return [(24 - x, y) for x, y in poly]


LOOP_R, NUM_R, SPAN_R = 1.4, 0.45, 0.9
repeat = [(mirror(p), LOOP_R) for p in LOOP]
repeat_one = repeat + [(ONE, NUM_R)]
span = [(p, SPAN_R) for p in SPAN]

RES = "modules/retracks-player/android/src/main/res/drawable/"
write_vector(RES + "retracks_ic_repeat.xml", repeat)
write_vector(RES + "retracks_ic_repeat_one.xml", repeat_one)
write_vector(RES + "retracks_ic_replay.xml", span)
# 通しで再生中であることを示す版。アプリの強調色に合わせる
write_vector(RES + "retracks_ic_replay_on.xml", span, tint="#E8912A")

write_png("assets/ic-repeat.png", repeat)
write_png("assets/ic-repeat-one.png", repeat_one)
write_png("assets/ic-fulltrack.png", span)
