## compact view mode
激活这个模式之后，用户看到的是

1. 模式 1：一行问题接着一行问题，没有agent的回答
2. 模式 2：一行问题后面紧接着agent回答

这样就不用担心找不到问题了

## context使用量
类似塞尔达的精力条，富裕的时候显示绿色，慢慢的过渡到黄色，再到红色表示窗口的使用情况
怎么visual的显示出来呢？

缺少：删除对话的能力
~~bugfix：文本长的时候闪烁的非常厉害~~
bugfix: 生成的时候向上滚动，滚动不了，而且闪屏

## session tab
- 把session显示成不同的tab
- source code也有单独的tab，但是是不同的tab类型


## files tab
- 右边侧边栏可以显示目录树；侧边栏可以切换支持显示git状态
- 这样就不用切换来切换去了
- 左右侧边栏都是用中间的区域进行显示内容，比如代码，diff，md 等

## subagents
- subagents 也要显示成session
- pi 支持subagents吗？不是说是单session的吗，怎么异步的


## chat everwhere
- 像是git commit的地方，不应该还是跟原来一样让用户输入message，应该是一个chat box或者有一个按钮让agent自动生成commit message

## search
- 给 agent 提供搜索其他 session 的能力，memory 存在 session 的树形结构中，而不是线性的 session 中
- session不能提供自动compact的能力：
  - 从某一个节点fork
  - 如果context满了没法 fork：用side memory实时的压缩的，用这个side memory进行fork，每一个对话结束的时候生成一个摘要自动加入到side memory，用户可以在 5s 之内回退掉
- 当然还能够搜索代码


## forward
- 转发消息，像聊天界面一样，可以把选中的消息转发给一个session
- 引用消息，直接引用好像也很棒，是不是只在当前的session引用比较好？或者可以在其他的session引用也可以；引用之后是不是不能直接发送给agent，因为human可能要针对性提问的，引用可的内容可以叠在inputbox上方吧

## subagents
- subagents是agent自动产生的，像session一样要产生一个session的页面
- session的名字前面要加一个图标，表示是自动产生的，不是用户创建的
- 当前有一个session的状态按钮，应该加到tab上面吧，没必要单独一个区域


## 产品
1. 将来上下文一定是很长的，1M 起步的话，根本不需要compact上下文这个功能
2. 按照 DeepSeek 的愿景，将来似乎可以达到无限上下文
3. 所以session才是first class component
4. human应该尽量少编辑代码或者文件，只解决手痒的问题，所以编辑功能不用特别强大，只要有就行。但是diff view功能一定要强大，要让human有掌控感。
5. agentd的吞吐太大了，human根本追不上，需要很长时间才能理解，所以有必要把所有的思考、执行过程展现出来
6. 不能外包思考，human还是要赶上agent的，要从 agent 学习和理解。

