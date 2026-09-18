# Markdown math preview

Inline: \(x_i^2 + \frac{1}{2}\), and $$e^{i\pi}+1=0$$.

## Matrices and alignment

\[
\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
\qquad
\begin{aligned}
f(x) &= x^2 \\
\int_0^1 f(x)\,dx &= \frac{1}{3}
\end{aligned}
\]

## Dollar display

$$
\sum_{i=1}^{n}i=\frac{n(n+1)}{2}
$$

## Horizontal scrolling

\[
\underbrace{x_1+x_2+x_3+x_4+x_5+x_6+x_7+x_8+x_9+x_{10}+x_{11}+x_{12}+x_{13}+x_{14}+x_{15}+x_{16}+x_{17}+x_{18}+x_{19}+x_{20}}_{\text{Scroll to see the entire expression}}=\sum_{i=1}^{20}x_i
\]

## Local error

Invalid: \(\frac{\). Valid neighbor: \(y=mx+b\).

## Code and links

Literal inline code: `\(x_i^2\)`.

```latex
\[
\frac{1}{2}
\]
```

```math
x_i^2
```

[KaTeX documentation](https://katex.org/docs/supported.html), **bold**, and escaped \*asterisks\*.

## Tables

| Type \(T\) | Formula | Description |
| :--- | :--- | :--- |
| Inline | \(x_i^2 + \frac{1}{2}\) | Formula with fraction |
| Single Dollar | $\mathbf{y} \in \mathbb{C}^{MN \times 1}$ | Single dollar notation |
| Matrix and Hat | $\widehat{\mathbf{H}}$ and $\sigma_{\mathrm{e}}^2$ | Multiple single dollars |
| Double Dollar | $$\alpha + \beta$$ | Standard double dollar notation |
| Display | \[\int_0^1 x^2\,dx\] | Definite integral |
| Multiple | \(a^2\) and \(b^2\) | Multiple expressions in cell |
| Code and Link | `\(code\)` and [KaTeX](https://katex.org) | Code and external link |
| Error cell | \(\frac{\) | Isolated invalid formula |
| Valid neighbor | \(y = mx + b\) | Continues rendering |
