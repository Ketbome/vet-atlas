"use client";

import { Component, type ReactNode } from "react";

type Props = { fallback: (retry: () => void) => ReactNode; children: ReactNode };
type State = { failed: boolean };

// Errors thrown inside the R3F canvas (a GLB that fails to load, a shader
// that will not compile) propagate to the nearest DOM error boundary. This one
// keeps the failure inside the viewer so the text panel stays usable.
export class SceneBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }));
    return this.props.children;
  }
}
