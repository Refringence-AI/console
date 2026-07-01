// Type shim for the vendored React Bits Grainient (JS+CSS) component, so it
// imports cleanly into the TS renderer without editing the vendored file.
import type { FC } from 'react';

export interface GrainientProps {
  color1?: string;
  color2?: string;
  color3?: string;
  className?: string;
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  grainAmount?: number;
  saturation?: number;
  zoom?: number;
  [key: string]: unknown;
}

declare const Grainient: FC<GrainientProps>;
export default Grainient;
