import { Tabs, TabsList, TabsTrigger, TabsContent } from 'birdbrain-ui'

const panel: React.CSSProperties = {
  padding: 14,
  fontSize: 13,
  color: 'var(--color-text-secondary)'
}

export const CaptureTabs = () => (
  <div style={{ width: 360 }}>
    <Tabs defaultValue="archive">
      <TabsList>
        <TabsTrigger value="archive">Archive</TabsTrigger>
        <TabsTrigger value="analysis">Analysis</TabsTrigger>
        <TabsTrigger value="forensics">Forensics</TabsTrigger>
      </TabsList>
      <TabsContent value="archive" style={panel}>
        The rendered MHTML snapshot as captured, with hash verification.
      </TabsContent>
      <TabsContent value="analysis" style={panel}>
        Extracted selectors and entity matches for this capture.
      </TabsContent>
      <TabsContent value="forensics" style={panel}>
        Audit manifest, timestamps, and chain-of-custody metadata.
      </TabsContent>
    </Tabs>
  </div>
)

export const LineVariant = () => (
  <div style={{ width: 360 }}>
    <Tabs defaultValue="all">
      <TabsList variant="line">
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="verified">Verified</TabsTrigger>
        <TabsTrigger value="flagged">Flagged</TabsTrigger>
      </TabsList>
      <TabsContent value="all" style={panel}>
        Underline-style tabs for secondary, in-content navigation.
      </TabsContent>
      <TabsContent value="verified" style={panel}>
        Captures whose hash matches the manifest.
      </TabsContent>
      <TabsContent value="flagged" style={panel}>
        Captures needing review.
      </TabsContent>
    </Tabs>
  </div>
)
