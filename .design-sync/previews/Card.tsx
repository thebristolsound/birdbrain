import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge
} from 'birdbrain-ui'

export const CaseCard = () => (
  <div style={{ maxWidth: 360 }}>
    <Card>
      <CardHeader>
        <CardTitle>Operation Nightjar</CardTitle>
        <CardDescription>Opened 3 days ago · 42 captures</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'flex', gap: 8 }}>
          <Badge variant="accent">Active</Badge>
          <Badge variant="outline">7 selectors</Badge>
        </div>
      </CardContent>
      <CardFooter style={{ gap: 12 }}>
        <Button size="sm">Open</Button>
        <Button size="sm" variant="ghost">Export</Button>
      </CardFooter>
    </Card>
  </div>
)

export const Interactive = () => (
  <div style={{ maxWidth: 360 }}>
    <Card hover interactive>
      <CardHeader>
        <CardTitle>example.com/article</CardTitle>
        <CardDescription>Captured 12:04 · MHTML · hash verified</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          Hover to lift. Interactive cards animate on pointer enter for
          clickable list rows.
        </p>
      </CardContent>
    </Card>
  </div>
)
