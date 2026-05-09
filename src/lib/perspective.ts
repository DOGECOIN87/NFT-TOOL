import { Point } from '../types';

function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    let maxEl = Math.abs(A[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > maxEl) {
        maxEl = Math.abs(A[k][i]);
        maxRow = k;
      }
    }

    if (maxEl < 1e-10) {
      return null;
    }

    for (let k = i; k < n; k++) {
      const tmp = A[maxRow][k];
      A[maxRow][k] = A[i][k];
      A[i][k] = tmp;
    }
    const tmpb = b[maxRow];
    b[maxRow] = b[i];
    b[i] = tmpb;

    for (let k = i + 1; k < n; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < n; j++) {
        if (i === j) {
          A[k][j] = 0;
        } else {
          A[k][j] += c * A[i][j];
        }
      }
      b[k] += c * b[i];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = b[i] / A[i][i];
    for (let k = i - 1; k >= 0; k--) {
      b[k] -= A[k][i] * x[i];
    }
  }
  return x;
}

export function getTransformMatrix(src: Point[], dst: Point[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    A.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].y * dst[i].x]);
    A.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x * dst[i].y, -src[i].y * dst[i].y]);
    b.push(dst[i].x);
    b.push(dst[i].y);
  }
  
  const x = solve(A, b);
  if (!x || x.some(Number.isNaN)) return null;

  return [
    x[0], x[3], 0, x[6],
    x[1], x[4], 0, x[7],
    0, 0, 1, 0,
    x[2], x[5], 0, 1
  ];
}

export function getPerspectiveTransform(src: Point[], dst: Point[]): string {
  const matrix = getTransformMatrix(src, dst);
  if (!matrix) return 'none';
  return `matrix3d(${matrix.map((n) => n.toFixed(10)).join(', ')})`;
}
