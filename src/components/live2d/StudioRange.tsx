import { usePointerRange } from '@hooks/usePointerRange';

/** Keep pointer capture on the same input throughout React updates; native input still handles keyboard changes. */
export function StudioRange({
  onValue,
  ...props
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  'aria-label': string;
  onValue: (value: number) => void;
}) {
  const pointer = usePointerRange(onValue);
  return <input type="range" {...props} {...pointer} />;
}
