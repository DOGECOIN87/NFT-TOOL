export type Point = {
  x: number;
  y: number;
};

export type Layer = {
  id: string;
  url: string;
  name: string;
  opacity: number;
  visible: boolean;
  corners: [Point, Point, Point, Point]; // TL, TR, BR, BL
  originalWidth: number;
  originalHeight: number;
  locked: boolean;
};
