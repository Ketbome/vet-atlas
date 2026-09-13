import { MDXRemote } from "next-mdx-remote/rsc";

export function Doc({ source }: { source: string }) {
  return (
    <div className="doc">
      <MDXRemote source={source} />
    </div>
  );
}
