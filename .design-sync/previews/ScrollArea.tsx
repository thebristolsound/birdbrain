import { ScrollArea } from 'birdbrain-ui'

const captures = [
  'example.com/article',
  'news.example.org/story/42',
  'blog.example.net/post',
  'docs.example.com/spec',
  'example.com/archive/2024',
  'forum.example.io/thread/9',
  'example.com/press-release',
  'cdn.example.com/asset'
]

export const CaptureList = () => (
  <div
    style={{
      height: 180,
      width: 300,
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      overflow: 'hidden'
    }}
  >
    <ScrollArea style={{ height: '100%' }}>
      <ul style={{ margin: 0, padding: 8, listStyle: 'none' }}>
        {captures.concat(captures).map((c, i) => (
          <li
            key={i}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              borderRadius: 8
            }}
          >
            {c}
          </li>
        ))}
      </ul>
    </ScrollArea>
  </div>
)
