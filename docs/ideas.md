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



## 产品
1. 将来上下文一定是很长的，1M 起步的话，根本不需要compact上下文这个功能
2. 按照 DeepSeek 的愿景，将来似乎可以达到无限上下文
3. 所以session才是first class component

