import { describe, it, expect } from 'vitest'
import { extractData } from '@main/services/dataExtractor'

describe('dataExtractor', () => {
  it('extracts tracking codes, accounts, and infrastructure indicators', () => {
    const html = `
      <script>
        const ga = 'UA-12345-1'
        const ads = 'AW-1234567890'
        const adsense = 'ca-pub-1234567890123456'
        fbq('init', '123456789012345')
      </script>
      <body>
        Contact us at Admin@Example.com or admin@example.com
        <a href="https://twitter.com/Test_User">Twitter</a>
        <a href="https://github.com/OctoCat">GitHub</a>
        <a href="https://instagram.com/my.handle">Instagram</a>
        <a href="https://linkedin.com/in/some-person">LinkedIn</a>
        <a href="https://youtube.com/@CreatorChannel">YouTube</a>
        <a href="https://t.me/channel_one">Telegram</a>
        <p>Hidden service: abcdefghijklmnop.onion</p>
      </body>
    `

    const extracted = extractData(html)

    expect(extracted).toEqual(
      expect.arrayContaining([
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' },
        { category: 'Tracking Code', subcategory: 'Google Ads', value: 'AW-1234567890' },
        {
          category: 'Tracking Code',
          subcategory: 'Google AdSense',
          value: 'ca-pub-1234567890123456'
        },
        {
          category: 'Tracking Code',
          subcategory: 'Facebook Pixel',
          value: '123456789012345'
        },
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'admin@example.com' },
        { category: 'Accounts', subcategory: 'Twitter/X', value: '@Test_User' },
        { category: 'Accounts', subcategory: 'GitHub', value: 'octocat' },
        { category: 'Accounts', subcategory: 'Instagram', value: 'my.handle' },
        { category: 'Accounts', subcategory: 'LinkedIn', value: 'some-person' },
        { category: 'Accounts', subcategory: 'YouTube', value: 'creatorchannel' },
        { category: 'Accounts', subcategory: 'Telegram', value: 'channel_one' },
        { category: 'Darkweb', subcategory: 'Onion URL', value: 'abcdefghijklmnop.onion' }
      ])
    )

    const emails = extracted.filter(
      (item) => item.subcategory === 'Email Address' && item.value === 'admin@example.com'
    )
    expect(emails).toHaveLength(1)
  })

  it('validates IPs and extracts domains from attributes', () => {
    const html = `
      <p>Public: 8.8.8.8, Invalid: 999.1.1.1</p>
      <p>IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334 and ::1 appear here</p>
      <img src="https://static.example.net/assets/app.js" />
      <form action="//secure.example.net/login"></form>
      <script>const gtag = 'G-ABCDEFG1234'</script>
    `

    const extracted = extractData(html)
    expect(extracted).toEqual(
      expect.arrayContaining([
        { category: 'Infrastructure', subcategory: 'IPv4 Address', value: '8.8.8.8' },
        {
          category: 'Infrastructure',
          subcategory: 'IPv6 Address',
          value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
        },
        { category: 'Infrastructure', subcategory: 'Domain Reference', value: 'static.example.net' },
        { category: 'Infrastructure', subcategory: 'Domain Reference', value: 'secure.example.net' },
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'G-ABCDEFG1234' }
      ])
    )

    const invalidIpv4 = extracted.find(
      (item) => item.subcategory === 'IPv4 Address' && item.value === '999.1.1.1'
    )
    expect(invalidIpv4).toBeUndefined()
  })
})
