const {rest} = require('msw')
const {setupServer} = require('msw/node')
const {handleNewMember, handleNewMessage, handleUpdatedMessage} = require('..')

const server = setupServer(
  rest.get('https://api.convertkit.com/v3/subscribers', (req, res, ctx) => {
    return res(
      ctx.json({
        total_subscribers: 0,
        page: 1,
        total_pages: 1,
        subscribers: [],
      }),
    )
  }),
  rest.post(
    'https://api.convertkit.com/v3/forms/:formId/subscribe',
    (req, res, ctx) => {
      const {formId} = req.params
      const {first_name, email, fields} = req.body
      return res(
        ctx.json({
          subscription: {
            id: 1234567890,
            state: 'active',
            created_at: new Date().toJSON(),
            source: 'API::V3::SubscriptionsController (external)',
            referrer: null,
            subscribable_id: formId,
            subscribable_type: 'form',
            subscriber: {
              id: 987654321,
              first_name,
              email_address: email,
              state: 'inactive',
              created_at: new Date().toJSON(),
              fields,
            },
          },
        }),
      )
    },
  ),
  rest.post(
    'https://api.convertkit.com/v3/tags/:tagId/subscribe',
    (req, res, ctx) => {
      const {tagId} = req.params
      const {first_name, email, fields} = req.body
      return res(
        ctx.json({
          subscription: {
            id: 1234567890,
            state: 'active',
            created_at: new Date().toJSON(),
            source: 'API::V3::SubscriptionsController (external)',
            referrer: null,
            subscribable_id: tagId,
            subscribable_type: 'tag',
            subscriber: {
              id: 987654321,
              first_name,
              email_address: email,
              state: 'inactive',
              created_at: new Date().toJSON(),
              fields,
            },
          },
        }),
      )
    },
  ),
  rest.get('https://www.gravatar.com/avatar/:hash', (req, res, ctx) => {
    return res(ctx.status(200))
  }),
)

beforeAll(() => server.listen({onUnhandledRequest: 'error'}))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// eslint-disable-next-line max-lines-per-function
async function setup() {
  const mockClient = {user: {id: 'mock-client', name: 'BOT'}}
  let channel
  const guild = {}

  const mockMember = {
    id: 'mock-user',
    name: 'Fred Joe',
    client: mockClient,
    guild,
    user: {
      id: 'mock-user',
      username: 'fredjoe',
      discriminator: '1234',
    },
    roles: {
      cache: {
        _roles: [],
        find(cb) {
          for (const role of this._roles) {
            if (cb(role)) return role
          }
          return null
        },
      },
      remove(role) {
        this.cache._roles = this.cache._roles.filter(r => r !== role)
        return Promise.resolve()
      },
      add(role) {
        this.cache._roles.push(role)
        return Promise.resolve()
      },
    },
    nickname: 'fred',
    setNickname(newNickname) {
      this.nickname = newNickname
      return Promise.resolve()
    },
  }
  mockMember.user.toString = function toString() {
    return `<@${this.id}>`
  }

  function createChannel(name, options) {
    return {
      id: `channel_${name}`,
      name,
      toString: () => `channel_${name}-id`,
      client: mockClient,
      type: 'text',
      messages: {
        _messages: [],
        _create({content, author}) {
          if (!content) {
            throw new Error('Trying to send a message with no content')
          }
          const message = {
            client: mockClient,
            guild,
            author,
            content,
            edit(newContent) {
              return updateMessage(message, newContent)
            },
            delete() {
              const index = channel.messages._messages.indexOf(message)
              channel.messages._messages.splice(index, 1)
            },
            channel,
          }
          return message
        },
        fetch() {
          return Promise.resolve(this._messages)
        },
      },
      delete: jest.fn(),
      async send(newMessageContent) {
        const message = this.messages._create({
          author: mockClient.user,
          content: newMessageContent,
        })
        this.messages._messages.unshift(message)
        // eslint-disable-next-line no-use-before-define
        await handleNewMessage(message)
        return message
      },
      ...options,
    }
  }

  Object.assign(guild, {
    client: mockClient,
    members: {
      cache: {
        find(cb) {
          if (cb(mockMember)) return mockMember
          return null
        },
      },
    },
    channels: {
      cache: {
        _channels: {
          welcomeCategoryChannel: createChannel('Welcome!', {
            type: 'category',
          }),
          introductionChannel: createChannel('👶-introductions'),
          botsOnlyChannel: createChannel('🤖-bots-only'),
          officeHoursVoiceChannel: createChannel(`🏫 Kent's Office Hours`, {
            type: 'voice',
          }),
          officeHoursChannel: createChannel(`🏫-office-hours`),
          kentLiveVoiceChannel: createChannel(`💻 Kent live`, {type: 'voice'}),
          kentLiveChannel: createChannel(`💻-kent-live`),
        },
        find(cb) {
          for (const ch of Object.values(this._channels)) {
            if (cb(ch)) return ch
          }
          throw new Error('unhandled case in channels.cache.find')
        },
      },
      create(name, options) {
        channel = createChannel(name, options)
        return channel
      },
    },
    roles: {
      cache: {
        _roles: {
          everyone: {name: '@everyone', id: 'everyone-role-id'},
          member: {name: 'Member', id: 'member-role-id'},
          unconfirmedMember: {
            name: 'Unconfirmed Member',
            id: 'unconfirmed-role-id',
          },
          liveStream: {
            name: 'Notify: Kent Live',
            id: 'notify-kent-live',
          },
          officeHours: {
            name: 'Notify: Office Hours',
            id: 'notify-office-hours',
          },
        },
        find(cb) {
          for (const role of Object.values(this._roles)) {
            if (cb(role)) return role
          }
          return null
        },
      },
    },
  })

  await handleNewMember(mockMember)

  expect(mockMember.roles.cache._roles).toEqual([
    guild.roles.cache._roles.unconfirmedMember,
  ])

  async function sendFromUser(content) {
    const message = channel.messages._create({author: mockMember, content})
    channel.messages._messages.unshift(message)
    await handleNewMessage(message)
    return message
  }

  async function updateMessage(oldMessage, newContent) {
    const messagesArray = channel.messages._messages
    const newMessage = channel.messages._create({
      author: oldMessage.author,
      content: newContent,
    })
    messagesArray[messagesArray.indexOf(oldMessage)] = newMessage
    await handleUpdatedMessage(oldMessage, newMessage)
    return newMessage
  }

  function getBotResponses() {
    const response = []
    for (const message of channel.messages._messages) {
      if (message.author.id === mockClient.user.id) response.push(message)
      else break
    }
    return response
      .map(m => `${m.author.name}: ${m.content}`)
      .reverse()
      .join('\n')
  }

  function getMessageThread(chan = channel) {
    return `
Messages in ${chan.name}

${chan.messages._messages
  .map(m => `${m.author.name}: ${m.content}`)
  .reverse()
  .join('\n')}
    `.trim()
  }

  return {
    send: sendFromUser,
    update: updateMessage,
    member: mockMember,
    messages: channel.messages._messages,
    channel,
    getMessageThread,
    getBotResponses,
  }
}

test('the typical flow', async () => {
  const {send, getMessageThread, member} = await setup()

  await send('Fred')
  await send('fred@example.com')
  await send('yes')
  await send('team@kentcdodds.com')
  await send('yes')
  await send('done')
  await send('yes')
  await send('yes')
  await send('anything else?')

  expect(getMessageThread()).toMatchInlineSnapshot(`
    "Messages in 👋-welcome-fredjoe_1234

    BOT: Hello <@mock-user> 👋

    I'm a bot and I'm here to welcome you to the KCD Community on Discord! Before you can join in the fun, I need to ask you a few questions. If you have any trouble, please email team@kentcdodds.com with your discord username (\`fredjoe#1234\`) and we'll get things fixed up for you.

    (Note, if you make a mistake, you can edit your responses).

    In less than 5 minutes, you'll have full access to this server. So, let's get started! Here's the first question:
    BOT: What's your first name?
    Fred Joe: Fred
    BOT: Great, hi Fred 👋
    BOT: _I've changed your nickname on this server to Fred. If you'd like to change it back then type: \`/nick fred\`_
    BOT: What's your email address? (This will add you to Kent's mailing list. You will receive a confirmation email.)
    Fred Joe: fred@example.com
    BOT: Awesome, when we're done here, you'll receive a confirmation email to: fred@example.com.
    BOT: Our community is commited to certain standards of behavior and we enforce that behavior to ensure it's a nice place to spend time.

    Please read about our code of conduct here: https://kentcdodds.com/conduct

    Do you agree to abide by and uphold the code of conduct? **The only correct answer is \\"yes\\"**
    Fred Joe: yes
    BOT: Great, thanks for helping us keep this an awesome place to be.
    BOT: **Based on what you read in the Code of Conduct**, what's the email address you send Code of Conduct concerns and violations to? (If you're not sure, open the code of conduct to find out).
    Fred Joe: team@kentcdodds.com
    BOT: That's right!
    BOT: Here are your answers:
      First Name: Fred
      Email: fred@example.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    Fred Joe: yes
    BOT: Awesome, welcome to the KCD Community on Discord!
    BOT: 🎉 You should be good to go now. Don't forget to check fred@example.com for a confirmation email. 📬

    🎊 You now have access to the whole server. Welcome!
    BOT: https://media.giphy.com/media/MDxjbPCg6DGf8JclbR/giphy.gif
    BOT: ━━━━━━━━━━━━━━━━━━━━

    **If you wanna hang out here for a bit longer, I have a few questions that will help you get set up in this server a bit more.**
    BOT: It's more fun here when folks have an avatar. You can go ahead and set yours now 😄

    I got this image using your email address with gravatar.com. You can use it for your avatar if you like.

    https://www.gravatar.com/avatar/6255165076a5e31273cbda50bb9f9636?s=128&d=404

    Here's how you set your avatar: https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-

    **When you're finished (or if you'd like to just move on), just say \\"done\\"**
    Fred Joe: done
    BOT: Ok, please do set your avatar later though. It helps keep everything human.
    BOT: Would you like to be notified when Kent starts live streaming in channel_💻-kent-live-id?
    Fred Joe: yes
    BOT: Cool, when Kent starts live streaming, you'll get notified.
    BOT: Would you like to be notified when Kent starts https://kcd.im/office-hours in channel_🏫-office-hours-id?
    Fred Joe: yes
    BOT: Great, you'll be notified when Kent's Office Hours start.
    BOT: Looks like we're all done! Go explore!

    We'd love to get to know you a bit. Tell us about you in channel_👶-introductions-id. Here's a template you can use:

    🌐 I'm from:
    🏢 I work at:
    💻 I work with this tech:
    🍎 I snack on:
    🤪 I'm unique because:

    Enjoy the community!
    Fred Joe: anything else?
    BOT: We're all done. This channel will get deleted automatically eventually, but if you want to delete it yourself, then say \\"delete\\"."
  `)

  expect(
    member.roles.cache._roles.map(({name}) => name).join(', '),
  ).toMatchInlineSnapshot(`"Member, Notify: Kent Live, Notify: Office Hours"`)
})

// eslint-disable-next-line max-lines-per-function
test('typing and editing to an invalid value', async () => {
  const {
    send,
    update,
    getMessageThread,
    getBotResponses,
    member,
    channel,
  } = await setup()

  const nameMessage = await send('Fred')

  // invalid email
  await send('not an email')
  expect(getBotResponses()).toMatchInlineSnapshot(
    `"BOT: That doesn't look like an email address. Please provide a proper email address."`,
  )

  // valid email
  let emailMessage = await send('fred@example.com')
  expect(getBotResponses()).toMatchInlineSnapshot(`
    "BOT: Awesome, when we're done here, you'll receive a confirmation email to: fred@example.com.
    BOT: Our community is commited to certain standards of behavior and we enforce that behavior to ensure it's a nice place to spend time.

    Please read about our code of conduct here: https://kentcdodds.com/conduct

    Do you agree to abide by and uphold the code of conduct? **The only correct answer is \\"yes\\"**"
  `)

  let cocMessage = await send('yes')
  expect(getBotResponses()).toMatchInlineSnapshot(`
    "BOT: Great, thanks for helping us keep this an awesome place to be.
    BOT: **Based on what you read in the Code of Conduct**, what's the email address you send Code of Conduct concerns and violations to? (If you're not sure, open the code of conduct to find out)."
  `)
  await send('team@kentcdodds.com')

  // edit something to invalid
  emailMessage = await update(emailMessage, 'not an email')
  expect(getBotResponses()).toMatchInlineSnapshot(`
    "BOT: That's right!
    BOT: Here are your answers:
      First Name: Fred
      Email: fred@example.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    BOT: There's a problem with an edit that was just made. Please edit the answer again to fix it. That doesn't look like an email address. Please provide a proper email address."
  `)

  cocMessage = await update(cocMessage, 'No')
  expect(getBotResponses()).toMatchInlineSnapshot(`
    "BOT: That's right!
    BOT: Here are your answers:
      First Name: Fred
      Email: fred@example.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    BOT: There's a problem with an edit that was just made. Please edit the answer again to fix it. That doesn't look like an email address. Please provide a proper email address.
    BOT: There's a problem with an edit that was just made. Please edit the answer again to fix it. You must agree to the code of conduct to join this community. Do you agree to abide by and uphold the code of conduct? (The answer must be \\"yes\\")"
  `)
  await update(emailMessage, 'fred@acme.com')
  expect(getBotResponses()).toMatchInlineSnapshot(`
    "BOT: That's right!
    BOT: Here are your answers:
      First Name: Fred
      Email: fred@acme.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    BOT: There's a problem with an edit that was just made. Please edit the answer again to fix it. You must agree to the code of conduct to join this community. Do you agree to abide by and uphold the code of conduct? (The answer must be \\"yes\\")"
  `)

  // try to send "yes" to complete everything despite there being an edit error
  await send('yes')
  expect(getBotResponses()).toMatchInlineSnapshot(
    `"BOT: There are existing errors with your previous answers, please edit your answer above before continuing."`,
  )

  await update(cocMessage, 'Yes')
  expect(getMessageThread()).not.toContain(`There's a problem with an edit`)

  await send('yes')

  await update(nameMessage, 'Freddy')

  await send('delete')

  expect(getMessageThread()).toMatchInlineSnapshot(`
    "Messages in 👋-welcome-fredjoe_1234

    BOT: Hello <@mock-user> 👋

    I'm a bot and I'm here to welcome you to the KCD Community on Discord! Before you can join in the fun, I need to ask you a few questions. If you have any trouble, please email team@kentcdodds.com with your discord username (\`fredjoe#1234\`) and we'll get things fixed up for you.

    (Note, if you make a mistake, you can edit your responses).

    In less than 5 minutes, you'll have full access to this server. So, let's get started! Here's the first question:
    BOT: What's your first name?
    Fred Joe: Freddy
    BOT: Great, hi Freddy 👋
    BOT: _I've changed your nickname on this server to Fred. If you'd like to change it back then type: \`/nick fred\`_
    BOT: What's your email address? (This will add you to Kent's mailing list. You will receive a confirmation email.)
    Fred Joe: not an email
    BOT: That doesn't look like an email address. Please provide a proper email address.
    Fred Joe: fred@acme.com
    BOT: Awesome, when we're done here, you'll receive a confirmation email to: fred@acme.com.
    BOT: Our community is commited to certain standards of behavior and we enforce that behavior to ensure it's a nice place to spend time.

    Please read about our code of conduct here: https://kentcdodds.com/conduct

    Do you agree to abide by and uphold the code of conduct? **The only correct answer is \\"yes\\"**
    Fred Joe: Yes
    BOT: Great, thanks for helping us keep this an awesome place to be.
    BOT: **Based on what you read in the Code of Conduct**, what's the email address you send Code of Conduct concerns and violations to? (If you're not sure, open the code of conduct to find out).
    Fred Joe: team@kentcdodds.com
    BOT: That's right!
    BOT: Here are your answers:
      First Name: Fred
      Email: fred@acme.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    Fred Joe: yes
    BOT: There are existing errors with your previous answers, please edit your answer above before continuing.
    BOT: Thanks for fixing things up, now we can continue.
    BOT: Here are your answers:
      First Name: Freddy
      Email: fred@acme.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    Fred Joe: yes
    BOT: Awesome, welcome to the KCD Community on Discord!
    BOT: 🎉 You should be good to go now. Don't forget to check fred@acme.com for a confirmation email. 📬

    🎊 You now have access to the whole server. Welcome!
    BOT: https://media.giphy.com/media/MDxjbPCg6DGf8JclbR/giphy.gif
    BOT: ━━━━━━━━━━━━━━━━━━━━

    **If you wanna hang out here for a bit longer, I have a few questions that will help you get set up in this server a bit more.**
    BOT: It's more fun here when folks have an avatar. You can go ahead and set yours now 😄

    I got this image using your email address with gravatar.com. You can use it for your avatar if you like.

    https://www.gravatar.com/avatar/53a99aa16438d50f6f7405749684b86e?s=128&d=404

    Here's how you set your avatar: https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-

    **When you're finished (or if you'd like to just move on), just say \\"done\\"**
    BOT: _I've changed your nickname on this server to Freddy. If you'd like to change it back then type: \`/nick Fred\`_
    BOT: Thanks for fixing things up, now we can continue.
    BOT: It's more fun here when folks have an avatar. You can go ahead and set yours now 😄

    I got this image using your email address with gravatar.com. You can use it for your avatar if you like.

    https://www.gravatar.com/avatar/53a99aa16438d50f6f7405749684b86e?s=128&d=404

    Here's how you set your avatar: https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-

    **When you're finished (or if you'd like to just move on), just say \\"done\\"**
    Fred Joe: delete"
  `)

  expect(
    member.roles.cache._roles.map(({name}) => name).join(', '),
  ).toMatchInlineSnapshot(`"Member"`)
  expect(channel.delete).toHaveBeenCalledTimes(1)
})

test('a new member with some info already', async () => {
  const {send, getMessageThread, member} = await setup()
  member.user.avatar = '123432'

  const email = 'fred+already-subscribed@example.com'

  server.use(
    rest.get('https://api.convertkit.com/v3/subscribers', (req, res, ctx) => {
      return res(
        ctx.json({
          total_subscribers: 1,
          page: 1,
          total_pages: 1,
          subscribers: [
            {
              id: 363855345,
              first_name: 'Fred',
              email_address: email,
              state: 'active',
              created_at: new Date().toJSON(),
              fields: {},
            },
          ],
        }),
      )
    }),
  )

  await send('Fred')
  await send(email)
  await send('yes')
  await send('team@kentcdodds.com')
  await send('yes')
  await send('yes')
  await send('yes')
  await send('anything else?')

  expect(getMessageThread()).toMatchInlineSnapshot(`
    "Messages in 👋-welcome-fredjoe_1234

    BOT: Hello <@mock-user> 👋

    I'm a bot and I'm here to welcome you to the KCD Community on Discord! Before you can join in the fun, I need to ask you a few questions. If you have any trouble, please email team@kentcdodds.com with your discord username (\`fredjoe#1234\`) and we'll get things fixed up for you.

    (Note, if you make a mistake, you can edit your responses).

    In less than 5 minutes, you'll have full access to this server. So, let's get started! Here's the first question:
    BOT: What's your first name?
    Fred Joe: Fred
    BOT: Great, hi Fred 👋
    BOT: _I've changed your nickname on this server to Fred. If you'd like to change it back then type: \`/nick fred\`_
    BOT: What's your email address? (This will add you to Kent's mailing list. You will receive a confirmation email.)
    Fred Joe: fred+already-subscribed@example.com
    BOT: Oh, nice, fred+already-subscribed@example.com is already a part of Kent's mailing list (you rock 🤘), so you won't be getting a confirmation email after all.
    BOT: Our community is commited to certain standards of behavior and we enforce that behavior to ensure it's a nice place to spend time.

    Please read about our code of conduct here: https://kentcdodds.com/conduct

    Do you agree to abide by and uphold the code of conduct? **The only correct answer is \\"yes\\"**
    Fred Joe: yes
    BOT: Great, thanks for helping us keep this an awesome place to be.
    BOT: **Based on what you read in the Code of Conduct**, what's the email address you send Code of Conduct concerns and violations to? (If you're not sure, open the code of conduct to find out).
    Fred Joe: team@kentcdodds.com
    BOT: That's right!
    BOT: Here are your answers:
      First Name: Fred
      Email: fred+already-subscribed@example.com
      Accepted Code of Conduct: Yes

    If you'd like to change any, then edit your responses above.

    **If everything's correct, simply reply \\"yes\\"**.
    Fred Joe: yes
    BOT: Awesome, welcome to the KCD Community on Discord!
    BOT: 🎉 You should be good to go now. 

    🎊 You now have access to the whole server. Welcome!
    BOT: https://media.giphy.com/media/MDxjbPCg6DGf8JclbR/giphy.gif
    BOT: ━━━━━━━━━━━━━━━━━━━━

    **If you wanna hang out here for a bit longer, I have a few questions that will help you get set up in this server a bit more.**
    BOT: Would you like to be notified when Kent starts live streaming in channel_💻-kent-live-id?
    Fred Joe: yes
    BOT: Cool, when Kent starts live streaming, you'll get notified.
    BOT: Would you like to be notified when Kent starts https://kcd.im/office-hours in channel_🏫-office-hours-id?
    Fred Joe: yes
    BOT: Great, you'll be notified when Kent's Office Hours start.
    BOT: Looks like we're all done! Go explore!

    We'd love to get to know you a bit. Tell us about you in channel_👶-introductions-id. Here's a template you can use:

    🌐 I'm from:
    🏢 I work at:
    💻 I work with this tech:
    🍎 I snack on:
    🤪 I'm unique because:

    Enjoy the community!
    Fred Joe: anything else?
    BOT: We're all done. This channel will get deleted automatically eventually, but if you want to delete it yourself, then say \\"delete\\"."
  `)

  expect(
    member.roles.cache._roles.map(({name}) => name).join(', '),
  ).toMatchInlineSnapshot(`"Member, Notify: Kent Live, Notify: Office Hours"`)
})
