import { Button } from '@design-ui/button';
import { Card, CardContent } from '@design-ui/card';

export const meta = { title: "Home", order: 0 };

export default function Page() {
  return (
    <Card>
      <CardContent>
        <h1 className="text-lg font-semibold">{"Home"}</h1>
        <p className="text-muted-foreground">This page was scaffolded by Design Mode. Edit this file to customize it.</p>
        <Button className="mt-2">Get started</Button>
      </CardContent>
    </Card>
  );
}
