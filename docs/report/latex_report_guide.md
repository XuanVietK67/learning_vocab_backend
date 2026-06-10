# LaTeX Report Writing Guide (HUST Đồ án / Graduation Thesis)

> Markdown transcription of `docs/report/manual.pptx` — *"Hướng dẫn viết đồ án bằng LaTeX"*
> by TS. Trần Hải Anh & TS. Trịnh Văn Chiến.
> This is the **authoritative format** for any report/thesis (đồ án) written in this repo.
> When writing or editing a LaTeX report, follow every rule below.

---

## 1. Why LaTeX (not MS Word)

The report **must** be written in LaTeX, not Word. Reasons the manual gives:

| Topic | MS Word | LaTeX |
|---|---|---|
| Formatting | Manual per-section formatting | Content auto-typeset from a declared structure |
| Headings / lists / numbering / TOC | Manual, slow | Automatic from one standard declaration, reusable across files |
| Sharing across machines/versions | Unstable (e.g. font breakage) | Plain text → shares cleanly, format never changes |
| Layout issues (e.g. whitespace) | Manual fixing | LaTeX auto-aligns |
| Numbering & cross-refs (equations, figures, tables, examples, theorems, chapters) | Hard to do and manage | Automatic, labelable, easy to reference and manage |

**LaTeX không khó!** Use Overleaf + the provided templates.

---

## 2. Overleaf

Online LaTeX editor + compiler. Advantages: no install, real-time collaboration, many ready templates.

Workflow:
1. Register / log in at <https://www.overleaf.com/>.
2. **Copy** the correct template project (Menu → Copy Project):
   - **Research direction (Nghiên cứu):** <https://www.overleaf.com/read/xtwzcxqbgyyj>
   - **Application direction (Ứng dụng):** <https://www.overleaf.com/read/vwyvykhjhzmx>
3. Pick the template that matches the thesis direction (Research vs Application).

---

## 3. Project file & folder structure (from the template)

Do **not** restructure the template. Keep this layout:

| Path | Purpose |
|---|---|
| `Chuong/` | One `.tex` file **per chapter** |
| images folder | All figures |
| cover-page `.tex` | Trang bìa (title page) |
| abbreviations file | Từ viết tắt (list of abbreviations) |
| `main.tex` | **Root file** — declares packages and `\include`s every chapter |
| `references.bib` | BibTeX bibliography database |

Write the report in order:
1. Prepare the **cover page** (trang bìa).
2. Write content **chapter by chapter**, one `.tex` file per chapter inside `Chuong/`.

---

## 4. Inserting images

- Uses the **`graphicx`** package — already declared at the top of `main.tex`.
- Store images in the images folder; reference them with the figure-insert command.
- Always give each figure a **caption**, a **`\label`**, and reference it with **`\ref`** (auto-numbered, never hardcode figure numbers).
- Reference: <https://www.overleaf.com/learn/latex/Inserting_Images>

```latex
\begin{figure}[h]
  \centering
  \includegraphics[width=0.8\textwidth]{images/architecture.png}
  \caption{System architecture}
  \label{fig:architecture}
\end{figure}

As shown in Figure~\ref{fig:architecture}, ...
```

---

## 5. Tables

- Build with **`tabular`**. Column spec declares count + alignment: `c` = center, `l` = left, `r` = right.
- `\\` ends a row. `\hline` draws a horizontal line; `|` / `||` in the column spec draw vertical borders.
- Add **caption + `\label` + `\ref`** exactly like figures.
- Tables are tedious — generators are allowed: <https://www.tablesgenerator.com/>
- Reference: <https://www.overleaf.com/learn/latex/Tables>

```latex
\begin{table}[h]
  \centering
  \begin{tabular}{||c c c c||}
    \hline
    Col1 & Col2 & Col3 & Col4 \\
    \hline
    a & b & c & d \\
    \hline
  \end{tabular}
  \caption{Example table}
  \label{tab:example}
\end{table}
```

---

## 6. Equations / math formulas

- Packages **`amsmath`, `amssymb`, `amsfonts`** — already added at the top of `main.tex`.
- **Inline mode** (formula inside a line of text): `\( ... \)`, `$ ... $`, or `\begin{math} ... \end{math}`.
- **Display mode** (formula on its own line): `\[ ... \]`, `\begin{displaymath} ... \end{displaymath}`, or `\begin{equation} ... \end{equation}`.
  - `equation` = **numbered**; `displaymath` / `\[ \]` = **unnumbered**.
- Helper tools: <https://latex.codecogs.com/>
- Reference: <https://www.overleaf.com/learn/latex/Mathematical_expressions>

```latex
The mass–energy relation is \( E = mc^2 \).

\begin{equation}
  \label{eq:euler}
  e^{i\pi} + 1 = 0
\end{equation}
```

---

## 7. Lists — bullets & numbering

- **Unordered (bullet):** `\begin{itemize} ... \end{itemize}`.
- **Ordered (numbered):** `\begin{enumerate} ... \end{enumerate}`.
- Each entry starts with `\item`.
- Other list styles: <https://www.overleaf.com/learn/latex/Lists>

```latex
\begin{itemize}
  \item First point
  \item Second point
\end{itemize}

\begin{enumerate}
  \item Step one
  \item Step two
\end{enumerate}
```

---

## 8. References (tài liệu tham khảo) — strict rules

1. Add each source as a BibTeX entry in **`references.bib`**.
2. Cite it in the text with **`\cite{ID}`**, where `ID` is that entry's key.

```bibtex
@article{harris2009cloud,
  title   = {...},
  author  = {...},
  year    = {2009},
  ...
}
```
→ cite with `\cite{harris2009cloud}`.

**Getting BibTeX** (e.g. via Google Scholar):
1. Go to <https://scholar.google.com/>.
2. Search the reference title.
3. Click **"Cite"** → choose **BibTeX**.

**Hard rules:**
- ❌ **Do NOT** use unverified sources, **Wikipedia**, or ordinary web pages as references.
- There are **5 reference types** students must format according to the regulations:
  - Book (sách)
  - Conference paper (báo cáo hội nghị khoa học)
  - Thesis — graduation project / master's / PhD (đồ án tốt nghiệp, luận văn thạc sĩ, tiến sĩ)
  - Internet source (tài liệu tham khảo từ Internet)
  - (+ the remaining standard type per the template's regulations)
- Each type has its **own required field layout** — match the template's prescribed format for that type.

---

## 9. Cross-referencing & numbering (general principle)

Everything numbered — figures, tables, equations, examples, theorems, chapters/sections — must use **`\label{...}` + `\ref{...}` / `\cite{...}`**. Never hardcode a number. LaTeX numbers and renumbers automatically; manual numbers will drift and are wrong by definition.

---

## Quick checklist when writing the report

- [ ] Right template copied (Research vs Application).
- [ ] One chapter per file under `Chuong/`, included from `main.tex`.
- [ ] Images via `graphicx`, with caption + `\label` + `\ref`.
- [ ] Tables via `tabular`, with caption + `\label` + `\ref`.
- [ ] Math via `amsmath` (inline vs display; `equation` only when it needs a number).
- [ ] Lists via `itemize` / `enumerate` with `\item`.
- [ ] Every source in `references.bib`, cited with `\cite{}`; no Wikipedia / unverified web pages; correct one of the 5 reference-type formats.
- [ ] No hardcoded numbers anywhere — always `\label` + `\ref`.
