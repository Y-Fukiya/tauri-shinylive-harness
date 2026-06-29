declare module "lucide-react/dist/esm/icons/*.mjs" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

  type LucideProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
    size?: string | number;
    absoluteStrokeWidth?: boolean;
  };

  const icon: ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;
  export default icon;
}
